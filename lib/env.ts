// lib/env.ts
/**
 * Environment variable validation
 * Ensures all required configs are present at build/runtime
 */

import { z } from 'zod';

// Define environment schema
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Next.js
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Firebase Client (public)
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1, 'Firebase API key is required'),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1, 'Firebase auth domain is required'),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().min(1, 'Firebase project ID is required'),
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: z.string().min(1, 'Firebase storage bucket is required'),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().min(1, 'Firebase messaging sender ID is required'),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1, 'Firebase app ID is required'),

  // Firebase Admin (private)
  FIREBASE_PROJECT_ID: z.string().min(1, 'Firebase admin project ID is required'),
  FIREBASE_CLIENT_EMAIL: z.string().email('Invalid Firebase client email'),
  FIREBASE_PRIVATE_KEY: z.string().min(1, 'Firebase private key is required'),

  // Google Cloud (optional)
  GOOGLE_CLOUD_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_VISION_KEY: z.string().optional(),

  // Rate Limiting (optional - for Redis)
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Security
  API_SECRET_KEY: z.string().min(32, 'API secret must be at least 32 characters').optional(),
  WEBHOOK_SECRET: z.string().min(32, 'Webhook secret must be at least 32 characters').optional(),
});

// Validate environment variables
function validateEnv() {
  try {
    const parsed = envSchema.parse(process.env);
    return parsed;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:');
      error.errors.forEach((err) => {
        console.error(`  • ${err.path.join('.')}: ${err.message}`);
      });
      throw new Error('Invalid environment configuration');
    }
    throw error;
  }
}

// Export validated env
export const env = validateEnv();

// Helper to check if running in production
export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

// Helper to check if feature is enabled
export const features = {
  redis: !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
  vision: !!(env.GOOGLE_CLOUD_PROJECT_ID && env.GOOGLE_CLOUD_VISION_KEY),
  webhooks: !!env.WEBHOOK_SECRET,
};

// Export types
export type Env = z.infer<typeof envSchema>;

// Validate on module load (fails fast at build/start time)
if (typeof window === 'undefined') {
  // Only validate on server
  validateEnv();
}
