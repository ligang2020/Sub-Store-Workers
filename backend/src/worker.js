import $ from '@/core/app';
import migrate from '@/utils/migration';
import serve from '@/restful';

const CACHE_KEY = 'sub-store-cache';
const DEFAULT_INSTANCE = 'default';
const AUTH_BASE_PATH = '/__substore/auth';
const SESSION_COOKIE = 'sub_store_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/**
 * A single Durable Object serializes requests so the upstream synchronous data
 * model remains safe while durable storage is backed by Cloudflare.
 */
export class SubStoreBackend {
    constructor(ctx, env) {
        this.ctx = ctx;
        this.env = env;
        this.app = null;
        this.ready = null;
    }

    async fetch(request) {
        await this.initialize();
        return this.app.fetch(request);
    }

    async initialize() {
        if (this.ready) return this.ready;
        this.ready = (async () => {
            const persisted = await this.ctx.storage.get(CACHE_KEY);
            if (persisted && typeof persisted === 'object') {
                $.cache = persisted.cache && typeof persisted.cache === 'object' ? persisted.cache : {};
                $.root = persisted.root && typeof persisted.root === 'object' ? persisted.root : {};
            }

            // The adapter reads $argument when it registers its CORS middleware.
            // Keep the value deployment-configurable without exposing it as a secret.
            globalThis.$argument = `cors=${encodeURIComponent(
                this.env.SUB_STORE_CORS_ALLOWED_ORIGINS || '*',
            )}`;
            globalThis.__SUB_STORE_WORKERS_PERSIST_CACHE__ = (snapshot) => {
                const data = JSON.parse(JSON.stringify(snapshot));
                this.ctx.waitUntil(this.ctx.storage.put(CACHE_KEY, data));
            };

            migrate();
            this.app = serve({ start: false });
        })();
        return this.ready;
    }
}

/**
 * The official Sub-Store front end is served from the same Worker as the API.
 * A small login gateway protects both the assets and API without CAPTCHA.
 *
 * Configure these in Cloudflare Workers > Settings > Variables and Secrets:
 * - SUB_STORE_ADMIN_PASSWORD (encrypted secret, required)
 * - SUB_STORE_ADMIN_USERNAME (plain-text variable, optional; defaults to admin)
 */
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const auth = getAuthConfig(env);

        if (url.pathname.startsWith(AUTH_BASE_PATH)) {
            return handleAuthRequest(request, url, auth);
        }

        if (!auth.isConfigured) {
            return configurationRequiredResponse(request);
        }

        const session = await readSession(request, auth.password);
        if (!session || session.username !== auth.username) {
            return unauthorizedResponse(request);
        }

        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
            const id = env.SUB_STORE_BACKEND.idFromName(DEFAULT_INSTANCE);
            return env.SUB_STORE_BACKEND.get(id).fetch(request);
        }

        return env.SUB_STORE_ASSETS.fetch(request);
    },
};

function getAuthConfig(env) {
    const username = `${env.SUB_STORE_ADMIN_USERNAME || 'admin'}`;
    const password = typeof env.SUB_STORE_ADMIN_PASSWORD === 'string'
        ? env.SUB_STORE_ADMIN_PASSWORD
        : '';
    return {
        username,
        password,
        isConfigured: password.length > 0,
    };
}

async function handleAuthRequest(request, url, auth) {
    const path = url.pathname.slice(AUTH_BASE_PATH.length) || '/';

    if (path === '/status' && request.method === 'GET') {
        const session = auth.isConfigured
            ? await readSession(request, auth.password)
            : null;
        return jsonResponse({
            authenticated: Boolean(session && session.username === auth.username),
            configured: auth.isConfigured,
        });
    }

    if (path === '/logout' && request.method === 'POST') {
        return jsonResponse(
            { authenticated: false },
            200,
            { 'Set-Cookie': clearSessionCookie(new URL(request.url).protocol === 'https:') },
        );
    }

    if (path === '/login' && request.method === 'POST') {
        if (!auth.isConfigured) {
            return jsonResponse(
                { message: 'The Worker administrator password is not configured.' },
                503,
            );
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ message: 'Invalid login request.' }, 400);
        }

        const username = typeof body?.username === 'string' ? body.username : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        if (!timingSafeEqual(username, auth.username) || !timingSafeEqual(password, auth.password)) {
            return jsonResponse({ message: '用户名或密码错误。' }, 401);
        }

        const session = await createSession(auth.username, auth.password);
        return jsonResponse(
            { authenticated: true },
            200,
            { 'Set-Cookie': createSessionCookie(session, new URL(request.url).protocol === 'https:') },
        );
    }

    return jsonResponse({ message: 'Not found.' }, 404);
}

function configurationRequiredResponse(request) {
    if (isDocumentRequest(request)) {
        return htmlResponse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sub-Store 初始化</title><style>${pageStyles()}</style></head>
<body><main class="card"><h1>Sub-Store 初始化</h1><p>登录保护已开启，但尚未设置管理员密码。</p>
<p>请在 Cloudflare Workers 的 <strong>Settings → Variables and Secrets</strong> 新建一个加密 Secret：</p>
<pre>SUB_STORE_ADMIN_PASSWORD</pre>
<p>可选：新建普通变量 <code>SUB_STORE_ADMIN_USERNAME</code>。未设置时用户名为 <code>admin</code>。</p>
<p>保存后重新部署或等待配置生效，然后刷新此页面。系统不使用验证码。</p></main></body></html>`, 503);
    }
    return jsonResponse({ message: 'Sub-Store administrator password is not configured.' }, 503);
}

function unauthorizedResponse(request) {
    if (!isDocumentRequest(request)) {
        return jsonResponse({ message: 'Authentication required.' }, 401);
    }

    return htmlResponse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sub-Store 登录</title><style>${pageStyles()}</style></head>
<body><main class="card"><h1>Sub-Store</h1><p class="subtitle">订阅管理控制台</p>
<form id="login-form"><label>用户名<input name="username" autocomplete="username" required autofocus></label>
<label>密码<input name="password" type="password" autocomplete="current-password" required></label>
<p id="error" role="alert"></p><button type="submit">登录</button></form>
<p class="hint">仅使用用户名和密码，不需要验证码。</p></main>
<script>const f=document.getElementById('login-form'),e=document.getElementById('error');f.addEventListener('submit',async a=>{a.preventDefault();e.textContent='';const b=new FormData(f);const r=await fetch('${AUTH_BASE_PATH}/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:b.get('username'),password:b.get('password')})});if(r.ok){location.replace('/');return}const d=await r.json().catch(()=>({}));e.textContent=d.message||'登录失败，请重试。'});</script>
</body></html>`);
}

function isDocumentRequest(request) {
    return request.method === 'GET' || request.method === 'HEAD'
        ? (request.headers.get('accept') || '').includes('text/html') || new URL(request.url).pathname === '/'
        : false;
}

function pageStyles() {
    return `:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#15112e,#59228b);color:#fff}.card{box-sizing:border-box;width:min(92vw,390px);padding:36px;border:1px solid #ffffff33;border-radius:24px;background:#ffffff14;box-shadow:0 22px 70px #0005}h1{margin:0;text-align:center;font-size:36px}.subtitle,.hint{text-align:center;color:#ded4ec}.hint{font-size:14px;margin:22px 0 0}form{display:grid;gap:18px;margin-top:28px}label{display:grid;gap:8px;font-size:16px}input,button{box-sizing:border-box;width:100%;border-radius:12px;font:inherit}input{padding:14px;border:1px solid #ffffff44;background:#ffffff13;color:#fff}button{border:0;padding:14px;background:linear-gradient(90deg,#12bcd4,#9335ee);color:#fff;font-weight:700;cursor:pointer}#error{min-height:20px;margin:0;color:#ffb6bd}pre,code{overflow:auto;padding:3px 6px;border-radius:6px;background:#0004;color:#fff}`;
}

async function createSession(username, password) {
    const payload = {
        username,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
        nonce: crypto.randomUUID(),
    };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = await sign(encodedPayload, password);
    return `${encodedPayload}.${signature}`;
}

async function readSession(request, password) {
    const value = readCookie(request.headers.get('cookie') || '', SESSION_COOKIE);
    if (!value) return null;
    const [encodedPayload, signature] = value.split('.');
    if (!encodedPayload || !signature || !(await verify(encodedPayload, signature, password))) return null;

    try {
        const payload = JSON.parse(base64UrlDecode(encodedPayload));
        if (!payload || typeof payload.username !== 'string' || !Number.isFinite(payload.expiresAt)) return null;
        return payload.expiresAt > Math.floor(Date.now() / 1000) ? payload : null;
    } catch {
        return null;
    }
}

async function sign(value, password) {
    const key = await getHmacKey(password, ['sign']);
    const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
    return base64UrlEncodeBytes(bytes);
}

async function verify(value, signature, password) {
    try {
        const key = await getHmacKey(password, ['verify']);
        return crypto.subtle.verify(
            'HMAC',
            key,
            base64UrlDecodeBytes(signature),
            new TextEncoder().encode(value),
        );
    } catch {
        return false;
    }
}

function getHmacKey(password, usages) {
    return crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        usages,
    );
}

function createSessionCookie(value, isHttps) {
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${isHttps ? '; Secure' : ''}`;
}

function clearSessionCookie(isHttps) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isHttps ? '; Secure' : ''}`;
}

function readCookie(header, name) {
    const prefix = `${name}=`;
    return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

function base64UrlEncode(value) {
    return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    return new TextDecoder().decode(base64UrlDecodeBytes(value));
}

function base64UrlDecodeBytes(value) {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function timingSafeEqual(left, right) {
    if (left.length !== right.length) return false;
    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return mismatch === 0;
}

function jsonResponse(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json;charset=UTF-8', ...headers },
    });
}

function htmlResponse(html, status = 200) {
    return new Response(html, {
        status,
        headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'no-store' },
    });
}
