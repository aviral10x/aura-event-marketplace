// lib/rate-limit.ts
/**
 * Rate limiting for API routes
 * Supports both Redis (Upstash) and in-memory storage
 */

// In-memory store (fallback when Redis not available)
const memoryStore = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed in the window
   */
  limit: number;
  /**
   * Time window in seconds
   */
  windowSeconds: number;
  /**
   * Custom identifier (defaults to IP)
   */
  identifier?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

/**
 * In-memory rate limiter (simple, works without Redis)
 */
export async function rateLimit(
  request: Request,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const identifier = config.identifier || getClientIdentifier(request);
  const key = `ratelimit:${identifier}`;

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Get or create entry
  let entry = memoryStore.get(key);

  // Clean expired entries periodically
  if (memoryStore.size > 1000) {
    cleanupMemoryStore();
  }

  // Reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
  }

  // Increment count
  entry.count++;
  memoryStore.set(key, entry);

  const success = entry.count <= config.limit;
  const remaining = Math.max(0, config.limit - entry.count);

  return {
    success,
    limit: config.limit,
    remaining,
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Redis-based rate limiter (requires Upstash)
 * Uncomment and use when UPSTASH_REDIS_REST_URL is configured
 */
/*
import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export async function rateLimitRedis(
  request: Request,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const identifier = config.identifier || getClientIdentifier(request)
  const key = `ratelimit:${identifier}`

  const now = Date.now()
  const windowMs = config.windowSeconds * 1000

  // Use Redis pipeline for atomic operations
  const pipeline = redis.pipeline()
  pipeline.incr(key)
  pipeline.expire(key, config.windowSeconds)
  pipeline.ttl(key)

  const [count, _, ttl] = await pipeline.exec() as [number, any, number]

  const success = count <= config.limit
  const remaining = Math.max(0, config.limit - count)
  const resetAt = new Date(now + ttl * 1000)

  return {
    success,
    limit: config.limit,
    remaining,
    resetAt,
  }
}
*/

/**
 * Get client identifier from request
 */
function getClientIdentifier(request: Request): string {
  // Try various headers to get client IP
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  return 'anonymous';
}

/**
 * Clean up expired entries from memory store
 */
function cleanupMemoryStore() {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now) {
      memoryStore.delete(key);
    }
  }
}

/**
 * Rate limit middleware for API routes
 */
export async function withRateLimit(
  request: Request,
  handler: () => Promise<Response>,
  config: RateLimitConfig
): Promise<Response> {
  const result = await rateLimit(request, config);

  // Add rate limit headers
  const headers = new Headers({
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetAt.toISOString(),
  });

  if (!result.success) {
    return new Response(
      JSON.stringify({
        error: 'Too many requests',
        message: `Rate limit exceeded. Try again after ${result.resetAt.toISOString()}`,
      }),
      {
        status: 429,
        headers: {
          ...Object.fromEntries(headers),
          'Content-Type': 'application/json',
          'Retry-After': Math.ceil(
            (result.resetAt.getTime() - Date.now()) / 1000
          ).toString(),
        },
      }
    );
  }

  // Execute handler
  const response = await handler();

  // Add rate limit headers to successful response
  headers.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}

/**
 * Preset rate limit configs
 */
export const RateLimits = {
  // Strict: 10 requests per 10 seconds
  STRICT: { limit: 10, windowSeconds: 10 },

  // Standard: 30 requests per minute
  STANDARD: { limit: 30, windowSeconds: 60 },

  // Relaxed: 100 requests per minute
  RELAXED: { limit: 100, windowSeconds: 60 },

  // Upload: 5 uploads per minute
  UPLOAD: { limit: 5, windowSeconds: 60 },

  // Auth: 5 attempts per 15 minutes
  AUTH: { limit: 5, windowSeconds: 900 },
};
