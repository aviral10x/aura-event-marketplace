// lib/cache.ts
/**
 * Caching utilities for Next.js
 * Supports ISR, client-side cache, and API response caching
 */

/**
 * In-memory cache for client-side
 */
class MemoryCache<T> {
  private cache = new Map<string, { data: T; expiresAt: number }>();

  set(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });

    // Cleanup old entries periodically
    if (this.cache.size > 100) {
      this.cleanup();
    }
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}

/**
 * Client-side cache instance
 */
export const clientCache = new MemoryCache<any>();

/**
 * Cache wrapper for async functions
 */
export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  // Check cache first
  const cached = clientCache.get(key);
  if (cached !== null) {
    return cached;
  }

  // Execute function and cache result
  const result = await fn();
  clientCache.set(key, result, ttlSeconds);
  return result;
}

/**
 * Invalidate cache by key or pattern
 */
export function invalidateCache(keyOrPattern: string): void {
  if (keyOrPattern.includes('*')) {
    // Clear all matching keys
    const pattern = keyOrPattern.replace('*', '');
    // Note: This would require exposing cache keys, simplified version:
    clientCache.clear();
  } else {
    clientCache.delete(keyOrPattern);
  }
}

/**
 * API Response Cache headers helper
 */
export function getCacheHeaders(
  strategy: 'no-cache' | 'short' | 'medium' | 'long' | 'immutable'
): Record<string, string> {
  const strategies = {
    'no-cache': {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
    short: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
    },
    medium: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
    long: {
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=300',
    },
    immutable: {
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  };

  return strategies[strategy];
}

/**
 * Next.js ISR helper
 * Add to your page/route to enable Incremental Static Regeneration
 */
export const revalidateConfig = {
  // Revalidate every minute
  short: 60,
  // Revalidate every 5 minutes
  medium: 300,
  // Revalidate every hour
  long: 3600,
  // Revalidate every day
  daily: 86400,
};

/**
 * SWR (Stale-While-Revalidate) fetcher with cache
 */
export async function swrFetcher<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const cacheKey = `swr:${url}`;

  // Return cached if available
  const cached = clientCache.get(cacheKey);
  if (cached) return cached;

  // Fetch and cache
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  clientCache.set(cacheKey, data, 60); // Cache for 1 minute

  return data;
}

/**
 * Debounced cache setter (for real-time updates)
 */
export class DebouncedCache<T> {
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(
    private key: string,
    private delayMs: number = 1000
  ) {}

  set(data: T, ttlSeconds: number = 300): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.timeoutId = setTimeout(() => {
      clientCache.set(this.key, data, ttlSeconds);
      this.timeoutId = null;
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}

/**
 * Cache key generator
 */
export function cacheKey(...parts: (string | number | boolean | null | undefined)[]): string {
  return parts
    .filter((p) => p !== null && p !== undefined)
    .map(String)
    .join(':');
}

/**
 * React hook for cached data (copy to component)
 */
/*
import { useState, useEffect } from 'react'

export function useCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = 300
) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const result = await cached(key, fetchFn, ttlSeconds)
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Unknown error'))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [key, ttlSeconds])

  const refetch = async () => {
    invalidateCache(key)
    setLoading(true)
    try {
      const result = await fetchFn()
      setData(result)
      clientCache.set(key, result, ttlSeconds)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  return { data, loading, error, refetch }
}
*/
