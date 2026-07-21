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
