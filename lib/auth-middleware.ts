// lib/auth-middleware.ts
/**
 * Enhanced authentication middleware for API routes
 * Verifies Firebase tokens and adds user context
 */

import { adminAuth } from '@/lib/firebase-admin';
import { AppError } from '@/lib/error-handler';
import { NextRequest } from 'next/server';

export interface AuthenticatedRequest extends NextRequest {
  user: {
    uid: string;
    email: string | undefined;
    emailVerified: boolean;
    phoneNumber: string | undefined;
    displayName: string | undefined;
    photoURL: string | undefined;
    customClaims?: Record<string, any>;
  };
}

/**
 * Require authentication middleware
 * Verifies Firebase ID token and attaches user to request
 */
export async function requireAuth(
  request: NextRequest
): Promise<AuthenticatedRequest['user']> {
  // Get token from Authorization header
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    throw new AppError('Missing authorization header', 'auth/no-token', 401);
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw new AppError(
      'Invalid authorization format. Use: Bearer <token>',
      'auth/invalid-format',
      401
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!token) {
    throw new AppError('Missing ID token', 'auth/no-token', 401);
  }

  try {
    // Verify the token
    const decodedToken = await adminAuth.verifyIdToken(token, true); // checkRevoked = true

    // Return user info
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified || false,
      phoneNumber: decodedToken.phone_number,
      displayName: decodedToken.name,
      photoURL: decodedToken.picture,
      customClaims: decodedToken,
    };
  } catch (error: any) {
    // Handle specific Firebase errors
    if (error.code === 'auth/id-token-expired') {
      throw new AppError('Token expired. Please sign in again.', 'auth/token-expired', 401);
    }

    if (error.code === 'auth/id-token-revoked') {
      throw new AppError('Token revoked. Please sign in again.', 'auth/token-revoked', 401);
    }

    if (error.code === 'auth/argument-error') {
      throw new AppError('Invalid token format', 'auth/invalid-token', 401);
    }

    // Generic auth error
    throw new AppError('Authentication failed', 'auth/verification-failed', 401);
  }
}

/**
 * Optional authentication middleware
 * Returns user if token is valid, null otherwise
 */
export async function optionalAuth(
  request: NextRequest
): Promise<AuthenticatedRequest['user'] | null> {
  try {
    return await requireAuth(request);
  } catch (error) {
    // Ignore auth errors for optional auth
    return null;
  }
}

/**
 * Check if user has admin role
 */
export async function requireAdmin(request: NextRequest): Promise<AuthenticatedRequest['user']> {
  const user = await requireAuth(request);

  if (!user.customClaims?.admin) {
    throw new AppError('Admin access required', 'auth/insufficient-permissions', 403);
  }

  return user;
}

/**
 * Check if user has specific custom claim
 */
export async function requireClaim(
  request: NextRequest,
  claim: string,
  value?: any
): Promise<AuthenticatedRequest['user']> {
  const user = await requireAuth(request);

  const claimValue = user.customClaims?.[claim];

  if (claimValue === undefined) {
    throw new AppError(`Missing required claim: ${claim}`, 'auth/missing-claim', 403);
  }

  if (value !== undefined && claimValue !== value) {
    throw new AppError(`Invalid claim value: ${claim}`, 'auth/invalid-claim', 403);
  }

  return user;
}

/**
 * Verify webhook signature
 * For external services that send webhooks
 */
export function verifyWebhookSignature(
  request: NextRequest,
  secret: string
): boolean {
  const signature = request.headers.get('x-webhook-signature');
  const timestamp = request.headers.get('x-webhook-timestamp');

  if (!signature || !timestamp) {
    return false;
  }

  // Verify timestamp is recent (within 5 minutes)
  const now = Date.now();
  const requestTime = parseInt(timestamp, 10);

  if (Math.abs(now - requestTime) > 5 * 60 * 1000) {
    return false;
  }

  // In production, verify HMAC signature
  // This is a simplified example - implement proper HMAC verification
  const expectedSignature = `webhook_${secret}_${timestamp}`;

  return signature === expectedSignature;
}

/**
 * API key authentication (for server-to-server)
 */
export function requireApiKey(request: NextRequest, validKeys: string[]): boolean {
  const apiKey = request.headers.get('x-api-key');

  if (!apiKey) {
    throw new AppError('Missing API key', 'auth/no-api-key', 401);
  }

  if (!validKeys.includes(apiKey)) {
    throw new AppError('Invalid API key', 'auth/invalid-api-key', 401);
  }

  return true;
}

/**
 * Check rate limit before processing (middleware helper)
 */
export async function checkRateLimit(
  request: NextRequest,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<boolean> {
  // This would integrate with your rate-limit.ts
  // Returns true if under limit, false if exceeded
  // Implementation depends on your rate limiting strategy
  return true; // Placeholder
}
