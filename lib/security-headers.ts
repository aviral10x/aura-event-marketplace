// lib/security-headers.ts
/**
 * Security headers configuration
 * Protects against common web vulnerabilities
 */

export interface SecurityHeadersOptions {
  enableCSP?: boolean;
  enableHSTS?: boolean;
  enableFrameGuard?: boolean;
  reportUri?: string;
}

/**
 * Get comprehensive security headers
 */
export function getSecurityHeaders(options: SecurityHeadersOptions = {}): HeadersInit {
  const {
    enableCSP = true,
    enableHSTS = true,
    enableFrameGuard = true,
    reportUri,
  } = options;

  const headers: Record<string, string> = {};

  // Content Security Policy
  if (enableCSP) {
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://www.googletagmanager.com https://vercel.live",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com https://vercel.live wss://*.firebaseio.com",
      "media-src 'self' https://storage.googleapis.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ];

    if (reportUri) {
      cspDirectives.push(`report-uri ${reportUri}`);
    }

    headers['Content-Security-Policy'] = cspDirectives.join('; ');
  }

  // HTTP Strict Transport Security
  if (enableHSTS) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
  }

  // Frame protection
  if (enableFrameGuard) {
    headers['X-Frame-Options'] = 'DENY';
  }

  // Prevent MIME type sniffing
  headers['X-Content-Type-Options'] = 'nosniff';

  // XSS Protection (legacy but still useful)
  headers['X-XSS-Protection'] = '1; mode=block';

  // Referrer Policy
  headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

  // Permissions Policy (formerly Feature Policy)
  headers['Permissions-Policy'] = [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
  ].join(', ');

  return headers;
}

/**
 * CORS configuration
 */
export interface CORSOptions {
  origin?: string | string[];
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export function getCORSHeaders(options: CORSOptions = {}): HeadersInit {
  const {
    origin = '*',
    methods = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders = ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    credentials = true,
    maxAge = 86400, // 24 hours
  } = options;

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': methods.join(', '),
    'Access-Control-Allow-Headers': allowedHeaders.join(', '),
    'Access-Control-Expose-Headers': exposedHeaders.join(', '),
    'Access-Control-Max-Age': maxAge.toString(),
  };

  // Handle origin
  if (Array.isArray(origin)) {
    // If multiple origins, you need to check the request origin
    // This is a simplified version - implement proper origin checking in middleware
    headers['Access-Control-Allow-Origin'] = origin[0];
  } else {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  // Credentials
  if (credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Apply security headers to a Response
 */
export function withSecurityHeaders(
  response: Response,
  options?: SecurityHeadersOptions
): Response {
  const securityHeaders = getSecurityHeaders(options);

  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Apply CORS headers to a Response
 */
export function withCORSHeaders(
  response: Response,
  options?: CORSOptions
): Response {
  const corsHeaders = getCORSHeaders(options);

  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Handle CORS preflight requests
 */
export function handlePreflight(options?: CORSOptions): Response {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(options),
  });
}

/**
 * Content Security Policy nonce generator
 * For inline scripts that need to bypass CSP
 */
export function generateCSPNonce(): string {
  // Generate a random nonce
  const randomBytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(randomBytes).toString('base64');
}

/**
 * Build CSP with nonce
 */
export function getCSPWithNonce(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.firebaseio.com https://*.googleapis.com wss://*.firebaseio.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Preset security configurations
 */
export const SecurityPresets = {
  // Strict security for production
  strict: {
    enableCSP: true,
    enableHSTS: true,
    enableFrameGuard: true,
  },

  // Relaxed for development
  development: {
    enableCSP: false,
    enableHSTS: false,
    enableFrameGuard: false,
  },

  // API-specific (no CSP for JSON APIs)
  api: {
    enableCSP: false,
    enableHSTS: true,
    enableFrameGuard: true,
  },
};

/**
 * Allowed origins for production
 */
export const ALLOWED_ORIGINS = [
  'https://clawsup.fun',
  'https://www.clawsup.fun',
  'https://aura-event-marketplace.vercel.app',
  // Add your production domains here
];

/**
 * Check if origin is allowed
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;

  // Allow localhost in development
  if (process.env.NODE_ENV === 'development') {
    return origin.includes('localhost') || origin.includes('127.0.0.1');
  }

  return ALLOWED_ORIGINS.includes(origin);
}
