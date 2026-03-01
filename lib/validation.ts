// lib/validation.ts
import { z } from 'zod';

// Event creation schema
export const eventSchema = z.object({
  name: z.string()
    .min(3, 'Event name must be at least 3 characters')
    .max(100, 'Event name is too long'),
  
  description: z.string()
    .max(500, 'Description is too long')
    .optional()
    .or(z.literal('')),
  
  location: z.string()
    .max(200, 'Location is too long')
    .optional()
    .or(z.literal('')),
  
  start_date: z.string()
    .optional()
    .or(z.literal('')),
  
  end_date: z.string()
    .optional()
    .or(z.literal('')),
  
  is_public: z.boolean()
    .default(true),
});

export type EventFormData = z.infer<typeof eventSchema>;

// File upload schema
export const uploadSchema = z.object({
  file: z.instanceof(File)
    .refine((f) => f.size <= 100_000_000, 'File size must be less than 100MB')
    .refine(
      (f) => {
        const validTypes = [
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp',
          'image/heic',
          'video/mp4',
          'video/quicktime', // .mov files
          'video/webm',
        ];
        return validTypes.includes(f.type);
      },
      'Only images (JPEG, PNG, WebP, HEIC) and videos (MP4, MOV, WebM) are allowed'
    ),
});

// Sign up schema
export const signUpSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address'),
  
  password: z.string()
    .min(6, 'Password must be at least 6 characters')
    .max(128, 'Password is too long'),
  
  full_name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name is too long')
    .optional(),
});

export type SignUpFormData = z.infer<typeof signUpSchema>;

// Sign in schema
export const signInSchema = z.object({
  email: z.string()
    .email('Please enter a valid email address'),
  
  password: z.string()
    .min(1, 'Password is required'),
});

export type SignInFormData = z.infer<typeof signInSchema>;

// Event code schema (for joining private events)
export const eventCodeSchema = z.object({
  code: z.string()
    .length(8, 'Event code must be 8 characters')
    .regex(/^[A-Z0-9]+$/, 'Invalid event code format'),
});

export type EventCodeData = z.infer<typeof eventCodeSchema>;
