/* eslint-disable no-undef */
import { ENV } from './open-api';
import {
    describeCorsPolicy,
    getCorsHeaders,
    isOriginAllowed,
    resolveRuntimeCorsPolicy,
} from '@/utils/cors';

/**
 * A deliberately small Express-compatible router.
 *
 * Node deployments use Express itself. Other script runtimes and Cloudflare
 * Workers use the adapter below, which exposes `app.fetch(request)` in
 * addition to the original `app.start()` callback entry point.
 */
export default function express({ substore: $, port, host }) {
    const { isNode } = ENV();
    const corsPolicy = resolveRuntimeCorsPolicy({ isNode });
    $.info(`[CORS] allowed origins: ${describeCorsPolicy(corsPolicy)}`);

    const DEFAULT_HEADERS = {
        'Content-Type': 'text/plain;charset=UTF-8',
        'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,PATCH,PUT,DELETE',
        'Access-Control-Allow-Headers':
            'Origin, X-Requested-With, Content-Type, Accept',
        'X-Powered-By': isNode
            ? eval('process.env.SUB_STORE_X_POWERED_BY') || 'Sub-Store'
            : 'Sub-Store',
    };

    if (isNode) {
        const express_ = eval(`require("express")`);
        const bodyParser = eval(`require("body-parser")`);
        const app = express_();
        const limit = eval('process.env.SUB_STORE_BODY_JSON_LIMIT') || '1mb';
        $.info(`[BACKEND] body JSON limit: ${limit}`);
        app.use((req, res, next) => {
            const originalSetHeader = res.setHeader.bind(res);
            res.setHeader = function (name, value) {
                function normalize(v) {
                    if (typeof v !== 'string') return v;
                    if (['profile-web-page-url'].includes(name.toLowerCase())) {
                        try {
                            return new URL(v).href;
                        } catch {
                            return v;
                        }
                    }
                    return v;
                }
                try {
                    value = Array.isArray(value)
                        ? value.map(normalize)
                        : normalize(value);
                    return originalSetHeader(name, value);
                } catch (err) {
                    console.log(`Invalid header ignored\n${name}: ${value}`);
                    return this;
                }
            };
            next();
        });
        app.use((req, res, next) => {
            const result = applyCors(req.headers?.origin, req.method);
            res.set({ ...DEFAULT_HEADERS, ...result.headers });
            if (!result.allowed) {
                res.status(403).end('CORS origin not allowed');
                return;
            }
            if (result.preflight) {
                res.status(200).end();
                return;
            }
            next();
        });
        app.use(bodyParser.json({ verify: rawBodySaver, limit }));
        app.use(bodyParser.urlencoded({ verify: rawBodySaver, extended: true }));
        app.use(bodyParser.raw({ verify: rawBodySaver, type: '*/*' }));
        app.start = () => {
            app.get('*', (req, res) => res.status(404).end());
            const listener = app.listen(port, host, () => {
                const { address, port: actualPort } = listener.address();
                $.info(`[BACKEND] listening on ${address}:${actualPort}`);
            });
        };
        return app;
    }

    const handlers = [];
    const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'ALL'];

    const app = {};
    METHODS.forEach((method) => {
        app[method.toLowerCase()] = (pattern, callback) => {
            handlers.push({ method, pattern, callback });
            return app;
        };
    });
    app.route = (pattern) => {
        const chainApp = {};
        METHODS.forEach((method) => {
            chainApp[method.toLowerCase()] = (callback) => {
                handlers.push({ method, pattern, callback });
                return chainApp;
            };
        });
        return chainApp;
    };

    app.fetch = async (request) => {
        const headers = Object.fromEntries(request.headers.entries());
        return dispatch({
            method: request.method,
            url: request.url,
            headers,
            body: await request.text(),
        });
    };

    // Legacy script-runtime entry point (Quantumult X, Surge, etc.).
    app.start = () => {
        dispatch($request).then(async (response) => {
            const headers = Object.fromEntries(response.headers.entries());
            const body = await response.text();
            $.done({ statusCode: response.status, headers, body });
        });
    };

    return app;

    async function dispatch(request, start = 0) {
        let { method, url, headers, body } = request;
        headers = formatHeaders(headers || {});
        method = `${method || 'GET'}`.toUpperCase();
        const { path, query } = extractURL(url);
        const cors = applyCors(headers.origin, method);
        const response = Response(cors.headers);

        if (!cors.allowed) return response.status(403).send('CORS origin not allowed');
        if (cors.preflight) return response.status(200).end();

        if (/json/i.test(headers['content-type'] || '') && typeof body === 'string' && body) {
            try {
                body = JSON.parse(body);
            } catch {
                return response.status(400).json({
                    status: 'failed',
                    message: 'Invalid JSON request body',
                });
            }
        }

        let selected = null;
        for (let i = start; i < handlers.length; i++) {
            const candidate = handlers[i];
            if (
                (candidate.method === 'ALL' || method === candidate.method) &&
                patternMatched(candidate.pattern, path)
            ) {
                selected = { ...candidate, index: i };
                break;
            }
        }

        if (!selected) {
            return response.status(404).json({
                status: 'failed',
                message: 'ERROR: 404 not found',
            });
        }

        const req = {
            method,
            url,
            path,
            query,
            params: extractPathParams(selected.pattern, path),
            headers,
            body,
        };
        const next = () => dispatch(request, selected.index + 1);
        try {
            await selected.callback(req, response, next);
            return response.toWebResponse();
        } catch (err) {
            $.error(`Unhandled route error: ${err?.stack || err}`);
            return response.status(500).json({
                status: 'failed',
                message: `Internal Server Error: ${err?.message || err}`,
            });
        }
    }

    function Response(corsHeaders = {}) {
        let statusCode = 200;
        let body = '';
        const headers = { ...DEFAULT_HEADERS, ...corsHeaders };
        const response = {
            status(code) {
                statusCode = code;
                return response;
            },
            send(value = '') {
                body = value == null ? '' : `${value}`;
                return response.toWebResponse();
            },
            end(value = '') {
                return response.send(value);
            },
            html(data) {
                response.set('Content-Type', 'text/html;charset=UTF-8');
                return response.send(data);
            },
            json(data) {
                response.set('Content-Type', 'application/json;charset=UTF-8');
                return response.send(JSON.stringify(data));
            },
            set(key, val) {
                if (typeof key === 'object') Object.assign(headers, key);
                else headers[key] = val;
                return response;
            },
            removeHeader(key) {
                delete headers[key];
                return response;
            },
            toWebResponse() {
                return new globalThis.Response(body, {
                    status: statusCode,
                    headers: sanitizeHeaders(headers),
                });
            },
        };
        return response;
    }

    function applyCors(origin, method) {
        const allowed = isOriginAllowed(corsPolicy, origin);
        return {
            allowed,
            preflight: Boolean(origin) && allowed && method?.toUpperCase() === 'OPTIONS',
            headers: allowed ? getCorsHeaders(corsPolicy, origin) : {},
        };
    }
}

function rawBodySaver(req, res, buf, encoding) {
    if (buf && buf.length) req.rawBody = buf.toString(encoding || 'utf8');
}

function sanitizeHeaders(headers) {
    const result = {};
    for (const [key, value] of Object.entries(headers)) {
        if (value == null) continue;
        try {
            // Validate values before the Response constructor sees them.
            result[key] = `${value}`;
        } catch {}
    }
    return result;
}

function formatHeaders(headers) {
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
}

function extractURL(url) {
    const parsed = new URL(url, 'https://sub-store.invalid');
    return {
        path: parsed.pathname || '/',
        query: Object.fromEntries(parsed.searchParams.entries()),
    };
}

function patternMatched(pattern, path) {
    if (pattern instanceof RegExp) return pattern.test(path);
    if (pattern === '*' || pattern === '/') return path === '/';
    const expected = `${pattern}`.split('/').filter(Boolean);
    const actual = `${path}`.split('/').filter(Boolean);
    if (expected.length !== actual.length) return false;
    return expected.every((segment, index) => segment.startsWith(':') || segment === actual[index]);
}

function extractPathParams(pattern, path) {
    if (typeof pattern !== 'string' || !pattern.includes(':')) return {};
    const expected = pattern.split('/').filter(Boolean);
    const actual = path.split('/').filter(Boolean);
    return Object.fromEntries(
        expected
            .map((segment, index) => [segment, actual[index]])
            .filter(([segment]) => segment.startsWith(':'))
            .map(([segment, value]) => [segment.slice(1), decodeURIComponent(value)]),
    );
}
