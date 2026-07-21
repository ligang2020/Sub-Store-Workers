import $ from '@/core/app';
import migrate from '@/utils/migration';
import serve from '@/restful';

const CACHE_KEY = 'sub-store-cache';
const DEFAULT_INSTANCE = 'default';

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

export default {
    async fetch(request, env) {
        const id = env.SUB_STORE_BACKEND.idFromName(DEFAULT_INSTANCE);
        return env.SUB_STORE_BACKEND.get(id).fetch(request);
    },
};
