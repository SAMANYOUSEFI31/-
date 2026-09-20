import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { getAppEnvironment, isProduction, isStaging, allowTestShortcuts } from '../security.js';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      requestId?: string;
      inboundRequestId?: string;
    }
  }
}

/**
 * Request ID Middleware
 * Generates an authoritative, server-controlled unique request identifier.
 * Attaches the identifier to the request and sets the X-Request-ID response header.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.headers['x-request-id'];
  if (typeof inbound === 'string' && inbound.trim()) {
    req.inboundRequestId = inbound.trim();
  }

  const requestId = crypto.randomUUID();
  req.id = requestId;
  req.requestId = requestId;

  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Safe accessor for request ID
 */
export function getRequestId(req?: Request | null): string {
  if (!req) return '';
  return req.requestId || req.id || '';
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory storage for rate limiting tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

// Periodic cleanup of expired window entries to prevent memory leaks
const rateLimitInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);
if (typeof rateLimitInterval === 'object' && rateLimitInterval && 'unref' in rateLimitInterval) {
  rateLimitInterval.unref();
}

/**
 * Smart Rate Limiter Middleware
 * Tracks request counts based on client IP and user identifier.
 */
export function createRateLimiter(options: { windowMs: number; max: number; messageFa?: string }) {
  const { windowMs, max, messageFa = 'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.' } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
        const identifier =
      (req.body && (req.body.phoneNumber || req.body.identifier || req.body.username || req.body.phone || req.body.email)) ||
      (req.user && ((req.user as any).userId || (req.user as any).id)) ||
      '';

    const key = `${req.path}:${ip}:${identifier}`;
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      const retryAfterSeconds = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(429).json({
        code: 'RATE_LIMIT_EXCEEDED',
        messageFa,
        message: 'Too many requests, please try again later.',
      });
      return;
    }

    next();
  };
}

/**
 * Strict Rate Limiter for Authentication routes (/api/auth, /api/login)
 * Item A8: Prevents Brute-force attacks
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 10, // Max 10 attempts
  messageFa: 'تلاش‌های ناموفق ورود بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.',
});

/**
 * General Rate Limiter for standard API endpoints
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: 100, // Max 100 requests per minute
});

/**
 * Security Headers Middleware
 * Implements strict dual-environment policy:
 * - Production: Strict CSP, restricted frame-ancestors / X-Frame-Options, secure connect-src / img-src, HSTS
 * - Development / Test Shortcuts: Permissive embed headers for AI Studio live preview iframe
 */
export function setSecurityHeaders(req: Request, res: Response, next: NextFunction): void {
  const isProd = isProduction();
  const isDevOrTest = allowTestShortcuts();

  // HTTP Strict Transport Security (HSTS)
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Dual-Environment Content Security Policy (CSP) & Frame-Protection
  if (isDevOrTest) {
    // Development / AI Studio Preview Mode: allow iframe embed while preserving asset integrity
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' *; frame-ancestors 'self' *;"
    );
  } else {
    // Strict Production Hardened Mode:
    // 1. frame-ancestors 'self' and X-Frame-Options: SAMEORIGIN (Eliminates clickjacking)
    // 2. connect-src strictly restricted to 'self' and verified external gateways (Zarinpal/API)
    // 3. img-src restricted to 'self' data: blob: https://*.zarinpal.com
    // 4. font-src and style-src preserved for Google Fonts (Vazirmatn/JetBrains/Plus Jakarta Sans)
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://*.zarinpal.com https://zarinpal.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' https://api.zarinpal.com https://payment.zarinpal.com https://sandbox.zarinpal.com; frame-ancestors 'self';"
    );
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  }

  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable Browser XSS filtering
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Strict Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Strip framework signature
  res.removeHeader('X-Powered-By');

  next();
}

/**
 * Custom Error Class for Application-specific API Errors
 */
export class AppError extends Error {
  public statusCode: number;
  public code: string;
  public messageFa: string;
  public details?: any;

  constructor(statusCode: number, code: string, messageFa: string, message?: string, details?: any) {
    super(message || messageFa);
    this.statusCode = statusCode;
    this.code = code;
    this.messageFa = messageFa;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Helper to sanitize error names for structured log output
 */
function sanitizeErrorName(rawName: any): string {
  if (typeof rawName !== 'string' || !rawName.trim()) return 'Error';
  return rawName.slice(0, 100).replace(/[^\w.-]/g, '_');
}

/**
 * Helper to sanitize error messages according to environment policy
 * In production: returns a generic safe message
 * In dev/test/staging: redacts secrets, passwords, tokens, connection strings, and OTP codes
 */
function sanitizeErrorMessage(rawMessage: any, env: string): string {
  if (env === 'production') {
    return 'An internal server error occurred.';
  }
  if (typeof rawMessage !== 'string' || !rawMessage.trim()) {
    return 'An unexpected error occurred.';
  }

  let sanitized = rawMessage;

  // Redact known environment variables and secrets if present
  const secretsToRedact = [
    process.env.JWT_SECRET,
    process.env.DATABASE_URL,
    process.env.SUPER_ADMIN_PASS,
    process.env.SUPER_ADMIN_PHONE,
    process.env.SUPER_ADMIN_EMAIL,
    process.env.ZARINPAL_MERCHANT_ID,
    process.env.SMS_API_KEY,
    process.env.ADMIN_PASS,
    process.env.ADMIN_PHONE
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 2);

  for (const secret of secretsToRedact) {
    sanitized = sanitized.split(secret).join('[REDACTED]');
  }

  // Redact Database connection URLs
  sanitized = sanitized.replace(/(?:postgres(?:ql)?|mysql|mongodb|redis|sqlite):\/\/[^\s"']+/gi, '[REDACTED_DB_URL]');

  // Redact Bearer tokens and JWTs
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_TOKEN]');
  sanitized = sanitized.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]');

  // Redact key=value or header: value sensitive patterns
  sanitized = sanitized.replace(/(?:password|pass|secret|token|authorization|cookie|apiKey|merchantId|otpCode|otp_code)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');

  // Redact labeled OTP / PIN digits
  sanitized = sanitized.replace(/(?:otp|code|pin)\s*[:=]?\s*(\d{5,6})/gi, 'otp:[REDACTED_OTP]');

  return sanitized;
}

/**
 * Unified API Error Handler Middleware (ErrorMap)
 * Item B4 & A9: Standard error response format and Stack Trace censoring in Production/Staging
 * Emits correlated structured JSON logs for unexpected 5xx errors.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  const isProd = isProduction();
  const appEnv = getAppEnvironment();
  const isStagingEnv = isStaging();
  const suppressStack = isProd || isStagingEnv || appEnv === 'production' || appEnv === 'staging' || appEnv === 'invalid';

  // Ensure X-Request-ID response header is preserved on error responses
  if (typeof res?.setHeader === 'function') {
    const existingHeader = typeof res?.getHeader === 'function' ? res.getHeader('X-Request-ID') : undefined;
    if (!existingHeader && (req?.requestId || req?.id)) {
      res.setHeader('X-Request-ID', (req.requestId || req.id)!);
    }
  }

  if (err.name === 'PreconditionRequiredError' || err.code === 'PRECONDITION_REQUIRED') {
    res.status(err.statusCode || 428).json({
      code: 'PRECONDITION_REQUIRED',
      messageFa: err.messageFa || 'ارسال expectedRevision برای این عملیات الزامی است.',
      entityType: err.entityType,
      entityId: err.entityId
    });
    return;
  }

  if (err.name === 'ConcurrencyConflictError' || err.code === 'CONFLICT') {
    res.status(409).json({
      code: 'CONFLICT',
      messageFa: err.messageFa || 'این داده در دستگاه دیگری تغییر یافته است. برای حفظ یکپارچگی، عملیات متوقف شد.',
      entityType: err.entityType,
      entityId: err.entityId,
      currentRevision: err.currentRevision,
      expectedRevision: err.expectedRevision
    });
    return;
  }

  if (err.name === 'ServiceUnavailableError' || err.code === 'SERVICE_UNAVAILABLE' || err.statusCode === 503 || err.status === 503) {
    res.status(503).json({
      code: 'SERVICE_UNAVAILABLE',
      messageFa: err.messageFa || 'سرویس پایگاه داده در دسترس نیست. لطفاً دقایقی دیگر مجدداً تلاش نمایید.',
      message: suppressStack ? 'Database persistence service is currently unavailable.' : (err.message || 'Database persistence service is currently unavailable.')
    });
    return;
  }

  const statusCode = err.statusCode || err.status || 500;
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR');
  const messageFa = err.messageFa || 'خطایی در پردازش درخواست روی داد.';

  const responseBody: {
    code: string;
    messageFa: string;
    message?: string;
    details?: any;
    stack?: string;
  } = {
    code,
    messageFa,
  };

  if (!suppressStack) {
    responseBody.message = err.message || 'An unexpected error occurred.';
    if (err.details !== undefined) {
      responseBody.details = err.details;
    }
    responseBody.stack = err.stack;
  } else {
    // Suppress sensitive stack traces and internal errors in production / staging
    if (statusCode < 500) {
      responseBody.message = err.message;
      if (err.details !== undefined) {
        responseBody.details = err.details;
      }
    } else {
      responseBody.message = 'An internal server error occurred.';
    }
  }

  // Structured Server-Side Error Logging for unexpected 5xx errors
  if (statusCode >= 500) {
    const rawPath = (req.baseUrl ? req.baseUrl + req.path : req.path) || (req.originalUrl ? req.originalUrl.split('?')[0] : '') || '/';
    const normalizedPath = rawPath.split('?')[0];
    const structuredLog = {
      event: 'server_error',
      requestId: req?.requestId || req?.id || (typeof res?.getHeader === 'function' ? (res.getHeader('X-Request-ID') as string) : undefined) || 'unknown',
      method: req.method || 'UNKNOWN',
      path: normalizedPath,
      statusCode,
      errorCode: code,
      environment: appEnv,
      timestamp: new Date().toISOString(),
      errorName: sanitizeErrorName(err?.name),
      message: sanitizeErrorMessage(err?.message, appEnv),
    };
    console.error(JSON.stringify(structuredLog));
  }

  res.status(statusCode).json(responseBody);
}
