/**
 * Bushido Discipline OS — Client Router Utilities
 * 
 * Provides minimal, zero-dependency History API routing for primary shells:
 * - / or /battlefield → Battlefield (default)
 * - /dashboard → Command / Cycle dashboard
 * - /more or /profile → More / Profile settings shell
 * - /archives → Archives and cycle history
 * - /admin → System administration panel
 *
 * Route Scheme for Archives:
 * In Bushido Discipline OS, Archives represents the historical cycles and performance ledger.
 * It is registered as a dedicated top-level URL: `/archives`.
 * For user flexibility and semantic consistency, `/more/archives` as well as legacy aliases
 * (`/database`, `/court`) are seamlessly routed to this same Archives view.
 */

export interface ResolvedRoute {
  tab: string;
  canonicalPath: string;
  isKnown: boolean;
}

/**
 * Normalizes a raw pathname: removes query parameters, hash fragments,
 * collapses trailing slashes, and lowercases for deterministic matching.
 */
export function normalizePathname(rawPath: string): string {
  if (!rawPath) return '/';
  const withoutQueryOrHash = rawPath.split('?')[0].split('#')[0].trim().toLowerCase();
  const withoutTrailingSlash = withoutQueryOrHash.replace(/\/+$/, '');
  return withoutTrailingSlash === '' ? '/' : withoutTrailingSlash;
}

/**
 * Resolves an active tab and canonical path from any given URL pathname.
 */
export function resolveTabFromPath(pathname: string): ResolvedRoute {
  const path = normalizePathname(pathname);

  // Battlefield (default landing)
  if (path === '/' || path === '/battlefield') {
    return {
      tab: 'battlefield',
      canonicalPath: path === '/' ? '/' : '/battlefield',
      isKnown: true
    };
  }

  // Dashboard / Cycle Command Center
  if (path === '/dashboard' || path === '/cycle') {
    return {
      tab: 'dashboard',
      canonicalPath: '/dashboard',
      isKnown: true
    };
  }

  // Profile / More / Settings Shell
  if (path === '/more' || path === '/profile' || path === '/settings') {
    return {
      tab: 'profile',
      canonicalPath: '/more',
      isKnown: true
    };
  }

  // Archives / History View
  // Route Scheme: /archives is the primary canonical route, with /more/archives,
  // /database, and /court supported as seamless aliases.
  if (
    path === '/archives' || 
    path === '/more/archives' || 
    path === '/database' || 
    path === '/court'
  ) {
    return {
      tab: 'archives',
      canonicalPath: '/archives',
      isKnown: true
    };
  }

  // Admin View
  if (path === '/admin') {
    return {
      tab: 'admin',
      canonicalPath: '/admin',
      isKnown: true
    };
  }

  // Unknown path fallback → redirects to default battlefield
  return {
    tab: 'battlefield',
    canonicalPath: '/battlefield',
    isKnown: false
  };
}

/**
 * Returns the canonical URL path corresponding to a given tab identifier.
 */
export function getPathForTab(tab: string): string {
  switch (tab) {
    case 'battlefield':
      return '/battlefield';
    case 'dashboard':
    case 'cycle':
      return '/dashboard';
    case 'profile':
    case 'settings':
    case 'more':
      return '/more';
    case 'archives':
    case 'database':
    case 'court':
      return '/archives';
    case 'admin':
      return '/admin';
    default:
      return '/battlefield';
  }
}
