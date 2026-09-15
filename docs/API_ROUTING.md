# Bushido Discipline OS — API Routing Architecture

This document details the current production and serverless routing mechanism between Vercel Edge rewrites, the `api/index.js` serverless wrapper, and the underlying Express application (`server.ts` / `dist/server.cjs`).

---

## 1. Request Lifecycle: How `GET /api/health` Reaches Express

When an incoming HTTP request targeting `GET /api/health` arrives in production:

```
[Client / Probe]
       │
       ▼  GET /api/health
[Vercel Edge Gateway (vercel.json)]
       │  Rewrite Rule: /api/(.*) ➔ /api?path=$1
       ▼
[Serverless Function: api/index.js]
       │  normalizeVercelUrl(req) reconstructs req.url = '/api/health'
       ▼
[Express Server (server.ts / dist/server.cjs)]
       │  app.get('/api/health') matches
       ▼
[Response JSON: {"status":"ok","ready":true,...}]
```

### Detailed Resolution Steps:
1. **Edge Match (`vercel.json`)**:
   - The edge router checks `vercel.json` rewrites in order.
   - The pattern `{"source": "/api/(.*)", "destination": "/api?path=$1"}` matches `/api/health` (where `$1 = health`).
   - The destination directs execution to the unified serverless entry point `api/index.js` with `req.url` set to `/api?path=health`.

2. **Serverless Normalization (`api/index.js`)**:
   - Vercel invokes the default export in `api/index.js` (`vercelHandler`).
   - `normalizeVercelUrl(req)` parses the request URL:
     - Detects `pathParam = "health"` from `parsed.searchParams.get('path')`.
     - Deletes the `path` key from query parameters to keep application queries clean.
     - Reconstructs `req.url = '/api/health'` (preserving any remaining query parameters).
     - Provides fallbacks for direct paths, `x-forwarded-uri`, and `x-now-route-matches`.

3. **Express Route Execution (`server.ts`)**:
   - The Express application receives `req.url = '/api/health'`.
   - The route handler `app.get('/api/health', ...)` executes.
   - Returns HTTP 200 with JSON payload:
     ```json
     {
       "status": "ok",
       "ready": true,
       "timestamp": "2026-09-15T10:22:30.000Z"
     }
     ```

---

## 2. Why `?path=` Exists

1. **Single Serverless Function Architecture**:
   - Bushido OS bundles the entire Express backend into a single serverless endpoint (`api/index.js` loading `dist/server.cjs`).
   - Rather than creating dozens of separate serverless lambdas for every sub-route (`api/health.js`, `api/logs.js`, `api/cycles.js`), a single function handles all API traffic.

2. **Vercel Rewrite Parameter Capture**:
   - In standard Vercel configuration, passing dynamic path segments to a single target function without file-system based routing (`api/[...path].js`) uses query string capture: `destination: "/api?path=$1"`.
   - The `?path=$1` parameter guarantees that the sub-path is reliably transmitted to the node handler across edge proxies and CDN layers.

---

## 3. Production Vercel Rewrite Configuration

The production `vercel.json` rewrites are locked as follows:

```json
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "/api?path=$1"
    },
    {
      "source": "/api",
      "destination": "/api"
    },
    {
      "source": "/((?!api(?:/|$)|assets/|fonts/|icons/|favicon.ico|manifest.json|sw.js).*)",
      "destination": "/index.html"
    }
  ]
```

### Architectural Rationale & Why `?path=$1` is Retained:
- **Zero Risk of Path Truncation**: When bundling an Express app behind a single serverless function (`api/index.js`), using query-based path forwarding (`/api?path=$1`) completely avoids Vercel edge proxy path-stripping discrepancies across environments (Vercel CLI local dev vs. AWS Lambda edge runtimes).
- **No Fragile File Renaming**: Introducing `api/[...path].js` previously broke static bundling and module resolution on Vercel deployments in this project.
- **Direct `/api` and Unmatched Route Resilience**:
  - `GET /api` and `GET /api/` are explicitly handled in Express (`app.get(['/api', '/api/'])`), returning service health info and permanently preventing `"Cannot GET /api"`.
  - Unmatched API routes fall through to `app.all('/api/*')`, returning structured JSON 404 (`{ error: "NOT_FOUND" }`) instead of raw HTML or plain text.

---

## 4. Critical Invariants (What Must NEVER Break)

Any future API routing cleanup or refactoring must strictly preserve the following four pillars:

### A. Health & Readiness Probes (JSON Contract)
- `GET /api/health` and `GET /api/ready` MUST always return a valid JSON object with `status` and `ready: boolean`.
- Must NEVER return HTML (such as SPA `index.html`) or unhandled 404/500 errors.
- External container probes, PaaS orchestrators, and uptime monitors depend on this exact JSON schema and HTTP status codes (200 for healthy, 503 for unavailable).

### B. Core Habit Mutations & State Persistence (`POST /api/logs`, `POST /api/cycles`)
- `POST /api/logs` (daily habit ticks, scores, autopsies) and `POST /api/cycles` (cycle creation, updates, resets) MUST receive intact HTTP method, headers (`Authorization`, `If-Match`), and JSON bodies.
- URL rewriting must never drop query strings or strip authorization headers.
- Habit ticks must continue writing directly to SQLite/Prisma without transient data loss or routing drops.

### C. Static Assets & PWA Cache
- Direct static paths (`/assets/*`, `/sw.js`, `/manifest.json`, `/favicon.svg`, icons) must bypass the API handler and SPA fallback.
- Must be served directly with optimal cache headers (`public, max-age=31536000, immutable` for hashed assets; `no-cache` for Service Worker and `index.html`).

### D. SPA Fallback
- All non-API routes (e.g., `/`, `/battlefield`, `/archives`, `/court`, `/admin`) must rewrite cleanly to `/index.html` via the SPA rewrite regex.
- The SPA negative lookahead pattern `((?!api(?:/|$)|assets/|fonts/|icons/|favicon.ico|manifest.json|sw.js).*)` ensures API calls are never misrouted to the React frontend.

---

## 5. Manual QA Verification Checklist

Use this checklist during staging/production verification to validate routing integrity:

1. **API Health & Metadata Check**:
   - Navigate to `/api/health` in the browser or via `curl -i https://<domain>/api/health`.
   - Verify HTTP `200 OK` and JSON response: `{"status":"ok","ready":true,...}`.
   - Navigate to `/api` and verify JSON response with service metadata.
   - Navigate to `/api/nonexistent-xyz` and verify HTTP `404` JSON response with `{ error: "NOT_FOUND" }`.

2. **Habit Tick Mutation & Persistence**:
   - Open the Battlefield view.
   - Toggle one of the 5 habit checkboxes (e.g. سحرخیزی / Wake Up).
   - Verify immediate score gauge update, sound chime, and successful `POST /api/logs` network request with HTTP `200`.
   - Refresh the page and confirm the habit tick state and score persist across reloads.

3. **Dashboard Navigation & Browser History / Back Button**:
   - Navigate through views: Battlefield &rarr; Hall of Records (Archives) &rarr; Settings / Admin.
   - Click browser Back and Forward buttons (or in-app back controls).
   - Confirm seamless client-side routing without full page reload errors, 404s, or API interception.

