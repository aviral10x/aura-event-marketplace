// lib/secure-api.ts
/**
 * Comprehensive API security wrapper
 * Combines authentication, rate limiting, validation, and security headers
 */

import { NextRequest } from 'next/server';
import { requireAuth, optionalAuth } from '@/lib/auth-middleware';
import { withRateLimit, RateLimitConfig } from '@/lib/rate-limit';
import { withSecurityHeaders, withCORSHeaders, handlePreflight } from '@/lib/security-headers';
import { handleApiError } from '@/lib/error-handler';
import { z } from 'zod';

export interface SecureAPIOptions {
  /**
   * Require authentication (Firebase token)
   */
  requireAuth?: boolean;

  /**
   * Rate limiting configuration
   */
  rateLimit?: RateLimitConfig;

  /**
   * Request body validation schema (Zod)
   */
  bodySchema?: z.ZodSchema;

  /**
   * Query params validation schema (Zod)
   */
  querySchema?: z.ZodSchema;

  /**
   * Enable CORS
   */
  cors?: boolean;

  /**
   * Allowed HTTP methods
   */
  methods?: string[];

  /**
   * Custom headers to add to response
   */
  headers?: Record<string, string>;
}

/**
 * Secure API wrapper with all protections
 */
export function secureAPI<T = any>(
  handler: (request: NextRequest, context: {
    user?: any;
    body?: any;
    query?: any;
  }) => Promise<Response>,
  options: SecureAPIOptions = {}
) {
  return async (request: NextRequest): Promise<Response> => {
    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS' && options.cors) {
        return handlePreflight();
      }

      // Check allowed methods
      if (options.methods && !options.methods.includes(request.method)) {
        return new Response(
          JSON.stringify({ error: 'Method not allowed' }),
          {
            status: 405,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      // Rate limiting
      if (options.rateLimit) {
        const rateLimitResponse = await withRateLimit(
          request,
          async () => {
            return await processRequest();
          },
          options.rateLimit
        );

        return rateLimitResponse;
      }

      return await processRequest();

      async function processRequest(): Promise<Response> {
        // Authentication
        let user = null;
        if (options.requireAuth) {
          user = await requireAuth(request);
        } else {
          user = await optionalAuth(request);
        }

        // Parse and validate body
        let body = null;
        if (options.bodySchema && request.method !== 'GET') {
          try {
            const rawBody = await request.json();
            body = options.bodySchema.parse(rawBody);
          } catch (error) {
            if (error instanceof z.ZodError) {
              return new Response(
                JSON.stringify({
                  error: 'Validation failed',
                  details: error.errors,
                }),
                {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                }
              );
            }
            throw error;
          }
        }

        // Parse and validate query params
        let query = null;
        if (options.querySchema) {
          try {
            const { searchParams } = new URL(request.url);
            const queryObj = Object.fromEntries(searchParams);
            query = options.querySchema.parse(queryObj);
          } catch (error) {
            if (error instanceof z.ZodError) {
              return new Response(
                JSON.stringify({
                  error: 'Invalid query parameters',
                  details: error.errors,
                }),
                {
                  status: 400,
                  headers: { 'Content-Type': 'application/json' },
                }
              );
            }
            throw error;
          }
        }

        // Execute handler
        let response = await handler(request, { user, body, query });

        // Add security headers
        response = withSecurityHeaders(response, { enableCSP: false }); // APIs don't need CSP

        // Add CORS headers
        if (options.cors) {
          response = withCORSHeaders(response);
        }

        // Add custom headers
        if (options.headers) {
          Object.entries(options.headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        }

        return response;
      }
    } catch (error: any) {
      console.error('API error:', error);

      const { message, statusCode } = handleApiError(error);

      let response = new Response(
        JSON.stringify({ error: message }),
        {
          status: statusCode,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      // Add security headers even to error responses
      response = withSecurityHeaders(response, { enableCSP: false });

      if (options.cors) {
        response = withCORSHeaders(response);
      }

      return response;
    }
  };
}

/**
 * Quick presets for common API patterns
 */
export const SecureAPIPresets = {
  /**
   * Public API (no auth, rate limited)
   */
  public: (handler: any) =>
    secureAPI(handler, {
      requireAuth: false,
      rateLimit: { limit: 30, windowSeconds: 60 },
      cors: true,
      methods: ['GET', 'POST', 'OPTIONS'],
    }),

  /**
   * Protected API (requires auth, rate limited)
   */
  protected: (handler: any) =>
    secureAPI(handler, {
      requireAuth: true,
      rateLimit: { limit: 30, windowSeconds: 60 },
      cors: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),

  /**
   * Strict API (requires auth, strict rate limit)
   */
  strict: (handler: any) =>
    secureAPI(handler, {
      requireAuth: true,
      rateLimit: { limit: 10, windowSeconds: 60 },
      cors: true,
      methods: ['POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),

  /**
   * Upload API (requires auth, low rate limit)
   */
  upload: (handler: any) =>
    secureAPI(handler, {
      requireAuth: true,
      rateLimit: { limit: 5, windowSeconds: 60 },
      cors: true,
      methods: ['POST', 'OPTIONS'],
    }),

  /**
   * Webhook API (no auth but signature verification)
   */
  webhook: (handler: any) =>
    secureAPI(handler, {
      requireAuth: false,
      cors: false,
      methods: ['POST'],
    }),
};

/**
 * Helper to create JSON response
 */
export function jsonResponse<T = any>(
  data: T,
  status: number = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Helper to create error response
 */
export function errorResponse(
  message: string,
  status: number = 400,
  details?: any
): Response {
  return jsonResponse(
    {
      error: message,
      ...(details && { details }),
    },
    status
  );
}

/**
 * Helper to create success response
 */
export function successResponse<T = any>(
  data: T,
  message?: string
): Response {
  return jsonResponse({
    success: true,
    ...(message && { message }),
    data,
  });
}
