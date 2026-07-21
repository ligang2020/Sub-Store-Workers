import { expect } from 'chai';
import { execFileSync } from 'child_process';
import path from 'path';

const backendRoot = path.resolve(__dirname, '../../..');

/**
 * Run in a fresh Node process because OpenAPI detects its runtime when the
 * module is first loaded. The normal test suite also exercises Node runtime.
 */
describe('Cloudflare Workers adapter', () => {
    it('serves the backend environment endpoint through Fetch', () => {
        const script = `
            globalThis.WebSocketPair = class WebSocketPair {};
            globalThis.$argument = 'cors=*';
            globalThis.__SUB_STORE_WORKERS_PERSIST_CACHE__ = () => {};
            const serve = require('./src/restful').default;
            (async () => {
                const app = serve({ start: false });
                const response = await app.fetch(new Request('https://example.test/'));
                const payload = await response.json();
                if (response.status !== 200 || payload.data.backend !== 'Cloudflare Workers') {
                    throw new Error(JSON.stringify({ status: response.status, payload }));
                }
            })().catch((error) => {
                console.error(error);
                process.exitCode = 1;
            });
        `;
        const output = execFileSync(
            process.execPath,
            ['-r', '@babel/register', '-e', script],
            { cwd: backendRoot, encoding: 'utf8' },
        );
        expect(output).to.include('[CORS] allowed origins: *');
    });
});

describe('Cloudflare Workers login gateway', () => {
    it('uses a username and password without a CAPTCHA before serving assets or API routes', function () {
        this.timeout(10_000);
        const script = `
            globalThis.WebSocketPair = class WebSocketPair {};
            const worker = require('./src/worker').default;
            const env = {
                SUB_STORE_ADMIN_USERNAME: 'owner',
                SUB_STORE_ADMIN_PASSWORD: 'a-long-test-password',
                SUB_STORE_ASSETS: {
                    fetch: async () => new Response('asset content'),
                },
                SUB_STORE_BACKEND: {
                    idFromName: () => 'default',
                    get: () => ({ fetch: async () => new Response('api content') }),
                },
            };
            (async () => {
                const initial = await worker.fetch(new Request('https://example.test/', {
                    headers: { accept: 'text/html' },
                }), env);
                const initialHtml = await initial.text();
                if (initial.status !== 200 || !initialHtml.includes('name=\"username\"') || !initialHtml.includes('name=\"password\"') || initialHtml.includes('name=\"captcha\"')) {
                    throw new Error('The password-only login form was not returned.');
                }

                const rejectedApi = await worker.fetch(new Request('https://example.test/api/utils/env'), env);
                if (rejectedApi.status !== 401) throw new Error('Unauthenticated API request was not rejected.');

                const login = await worker.fetch(new Request('https://example.test/__substore/auth/login', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ username: 'owner', password: 'a-long-test-password' }),
                }), env);
                const cookie = login.headers.get('set-cookie');
                if (login.status !== 200 || !cookie || !cookie.includes('HttpOnly') || !cookie.includes('SameSite=Strict')) {
                    throw new Error('Login did not create a protected session cookie.');
                }

                const authenticatedAsset = await worker.fetch(new Request('https://example.test/index.js', {
                    headers: { cookie },
                }), env);
                if (authenticatedAsset.status !== 200 || await authenticatedAsset.text() !== 'asset content') {
                    throw new Error('Authenticated asset request was not served.');
                }

                const authenticatedApi = await worker.fetch(new Request('https://example.test/api/utils/env', {
                    headers: { cookie },
                }), env);
                if (authenticatedApi.status !== 200 || await authenticatedApi.text() !== 'api content') {
                    throw new Error('Authenticated API request was not forwarded.');
                }

                const setupRequired = await worker.fetch(new Request('https://example.test/', {
                    headers: { accept: 'text/html' },
                }), { ...env, SUB_STORE_ADMIN_PASSWORD: '' });
                if (setupRequired.status !== 503 || !(await setupRequired.text()).includes('SUB_STORE_ADMIN_PASSWORD')) {
                    throw new Error('Missing password configuration was not explained.');
                }
            })().catch((error) => {
                console.error(error);
                process.exitCode = 1;
            });
        `;
        execFileSync(
            process.execPath,
            ['-r', '@babel/register', '-e', script],
            { cwd: backendRoot, encoding: 'utf8' },
        );
    });
});
