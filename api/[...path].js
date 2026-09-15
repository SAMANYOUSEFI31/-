import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler, { normalizeVercelUrl } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distServerPath = path.resolve(__dirname, '../dist/server.cjs');

// Robust ESM/CJS interop handler for Vercel Serverless Functions
let directApp = handler;
if (!directApp) {
  let serverModule;
  if (fs.existsSync(distServerPath)) {
    const imported = await import('../dist/server.cjs');
    serverModule = imported.default || imported;
  } else {
    const imported = await import('../server.ts');
    serverModule = imported.default || imported;
  }
  directApp = typeof serverModule === 'function'
    ? serverModule
    : (serverModule && typeof serverModule.default === 'function')
      ? serverModule.default
      : (serverModule && serverModule.default && typeof serverModule.default.default === 'function')
        ? serverModule.default.default
        : serverModule;
}

export default function vercelCatchAllHandler(req, res, next) {
  if (typeof normalizeVercelUrl === 'function') {
    normalizeVercelUrl(req);
  }
  return directApp(req, res, next);
}

// Forward Express application properties and methods
if (directApp && typeof directApp === 'function') {
  Object.setPrototypeOf(vercelCatchAllHandler, directApp);
  Object.assign(vercelCatchAllHandler, directApp);
}
