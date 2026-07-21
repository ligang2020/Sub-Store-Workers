const { cp, rm, stat } = require('node:fs/promises');
const { join, resolve } = require('node:path');

const frontendDist = resolve(__dirname, '../../frontend/dist');
const workerAssets = resolve(__dirname, '../assets');

async function main() {
    try {
        const info = await stat(frontendDist);
        if (!info.isDirectory()) throw new Error('not a directory');
    } catch {
        throw new Error(`Front-end build output was not found at ${frontendDist}. Run \"pnpm build\" in frontend first.`);
    }

    await rm(workerAssets, { recursive: true, force: true });
    await cp(frontendDist, workerAssets, { recursive: true });
    console.log(`Copied ${frontendDist} to ${workerAssets}`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
