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
const rawApp = typeof serverModule === 'function'
  ? serverModule
  : (serverModule && typeof serverModule.default === 'function')
    ? serverModule.default
    : (serverModule && serverModule.default && typeof serverModule.default.default === 'function')
      ? serverModule.default.default
      : serverModule;

/**
 * Normalizes incoming Vercel serverless request URLs so Express matches full /api/* routes.
 */
function normalizeVercelUrl(req) {
  try {
    const rawUrl = req.url || '';
    const parsed = new URL(rawUrl, 'http://localhost');
    const pathParam = parsed.searchParams.get('path');

    if (pathParam) {
      // Reconstruct /api/<pathParam> and preserve remaining query parameters
      parsed.searchParams.delete('path');
      const cleanPath = pathParam.startsWith('/') ? pathParam : `/${pathParam}`;
      const search = parsed.searchParams.toString();
      req.url = `/api${cleanPath}${search ? `?${search}` : ''}`;
      return;
    }

    const forwardedUri = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'];
    if (forwardedUri && forwardedUri.startsWith('/api')) {
      req.url = forwardedUri;
      return;
    }

    const routeMatches = req.headers['x-now-route-matches'];
    if (routeMatches && typeof routeMatches === 'string') {
      const matchParams = new URLSearchParams(routeMatches);
      const subPath = matchParams.get('1') || matchParams.get('path');
      if (subPath) {
        const cleanSub = subPath.startsWith('/') ? subPath : `/${subPath}`;
        req.url = `/api${cleanSub}${parsed.search}`;
        return;
      }
    }

    if (rawUrl && !rawUrl.startsWith('/api')) {
      const clean = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
      req.url = `/api${clean}`;
    }
  } catch {
    // Fail-safe
  }
}

export default function vercelHandler(req, res, next) {
  normalizeVercelUrl(req);
  return rawApp(req, res, next);
}

// Forward Express application properties and methods (use, get, post, etc.)
if (rawApp && typeof rawApp === 'function') {
  Object.setPrototypeOf(vercelHandler, rawApp);
  Object.assign(vercelHandler, rawApp);
}


