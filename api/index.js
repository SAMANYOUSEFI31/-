import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distServerPath = path.resolve(__dirname, '../dist/server.cjs');

let serverModule;
if (fs.existsSync(distServerPath) && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  const imported = await import('../dist/server.cjs');
  serverModule = imported.default || imported;
} else {
  try {
    const imported = await import('../server.ts');
    serverModule = imported.default || imported;
  } catch {
    const imported = await import('../dist/server.cjs');
    serverModule = imported.default || imported;
  }
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
export function normalizeVercelUrl(req) {
  try {
    const rawUrl = req.url || '';
    const parsed = new URL(rawUrl, 'http://localhost');

    // 1. Primary path: if request is already /api/... (real path), keep it intact!
    if (
      parsed.pathname.startsWith('/api') &&
      parsed.pathname !== '/api' &&
      parsed.pathname !== '/api/' &&
      !parsed.pathname.includes('[...path]')
    ) {
      if (parsed.searchParams.has('path')) {
        parsed.searchParams.delete('path');
        const search = parsed.searchParams.toString();
        req.url = `${parsed.pathname}${search ? `?${search}` : ''}`;
      }
      return;
    }

    // 2. Query parameter rewrite (?path=health or ?path=logs)
    const pathParam = parsed.searchParams.get('path');
    if (pathParam && !pathParam.includes('[...path]')) {
      // Reconstruct /api/<pathParam> and preserve remaining query parameters
      parsed.searchParams.delete('path');
      const cleanPath = pathParam.startsWith('/') ? pathParam : `/${pathParam}`;
      const search = parsed.searchParams.toString();
      req.url = `/api${cleanPath}${search ? `?${search}` : ''}`;
      return;
    }

    // 3. Fallback: forwarded headers
    const forwardedUri = req.headers['x-forwarded-uri'] || req.headers['x-matched-path'];
    if (forwardedUri && forwardedUri.startsWith('/api') && !forwardedUri.includes('[...path]')) {
      req.url = forwardedUri;
      return;
    }

    // 4. Fallback: x-now-route-matches
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

    // 5. Fallback: if Vercel stripped /api prefix (e.g. /health -> /api/health)
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


