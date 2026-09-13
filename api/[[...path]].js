import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distServerPath = path.resolve(__dirname, '../dist/server.cjs');

let serverModule;
if (fs.existsSync(distServerPath)) {
  const imported = await import('../dist/server.cjs');
  serverModule = imported.default || imported;
} else {
  const imported = await import('../server.ts');
  serverModule = imported.default || imported;
}

// Robust ESM/CJS interop handler for Vercel Serverless Functions
const app = typeof serverModule === 'function'
  ? serverModule
  : (serverModule && typeof serverModule.default === 'function')
    ? serverModule.default
    : (serverModule && serverModule.default && typeof serverModule.default.default === 'function')
      ? serverModule.default.default
      : serverModule;

export default app;
