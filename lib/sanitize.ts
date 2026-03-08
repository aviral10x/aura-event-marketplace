// lib/sanitize.ts
/**
 * Input sanitization utilities
 * Prevents XSS, SQL injection, and other injection attacks
 */

/**
 * Sanitize HTML string
 * Removes dangerous HTML tags and attributes
 */
export function sanitizeHTML(input: string): string {
  if (!input) return '';

  // Remove script tags
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove data: protocol (can be used for XSS)
  sanitized = sanitized.replace(/data:text\/html/gi, '');

  return sanitized;
}

/**
 * Sanitize plain text input
 * Escapes HTML entities
 */
export function sanitizeText(input: string): string {
  if (!input) return '';

  const entityMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;',
  };

  return String(input).replace(/[&<>"'\/]/g, (s) => entityMap[s]);
}

/**
 * Sanitize SQL input
 * Escapes characters that could be used in SQL injection
 */
export function sanitizeSQL(input: string): string {
  if (!input) return '';

  // Remove SQL keywords
  const sqlKeywords = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi;
  let sanitized = input.replace(sqlKeywords, '');

  // Escape single quotes
  sanitized = sanitized.replace(/'/g, "''");

  // Remove semicolons (statement terminators)
  sanitized = sanitized.replace(/;/g, '');

  // Remove comments
  sanitized = sanitized.replace(/--/g, '');
  sanitized = sanitized.replace(/\/\*/g, '');
  sanitized = sanitized.replace(/\*\//g, '');

  return sanitized;
}

/**
 * Sanitize file path
 * Prevents path traversal attacks
 */
export function sanitizePath(input: string): string {
  if (!input) return '';

  // Remove directory traversal patterns
  let sanitized = input.replace(/\.\./g, '');

  // Remove leading slashes
  sanitized = sanitized.replace(/^\/+/, '');

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  return sanitized;
}

/**
 * Sanitize URL
 * Ensures URL is safe and valid
 */
export function sanitizeURL(input: string): string | null {
  if (!input) return null;

  try {
    const url = new URL(input);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    // Remove dangerous characters from URL
    const sanitized = url.toString()
      .replace(/javascript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/vbscript:/gi, '');

    return sanitized;
  } catch {
    // Invalid URL
    return null;
  }
}

/**
 * Sanitize email address
 * Basic email validation and sanitization
 */
export function sanitizeEmail(input: string): string | null {
  if (!input) return null;

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const trimmed = input.trim().toLowerCase();

  if (!emailRegex.test(trimmed)) {
    return null;
  }

  // Remove potentially dangerous characters
  const sanitized = trimmed.replace(/[<>'"]/g, '');

  return sanitized;
}

/**
 * Sanitize phone number
 * Removes non-numeric characters except + and -
 */
export function sanitizePhone(input: string): string {
  if (!input) return '';

  return input.replace(/[^\d+\-\s()]/g, '');
}

/**
 * Sanitize filename
 * Removes dangerous characters from filenames
 */
export function sanitizeFilename(input: string): string {
  if (!input) return '';

  // Remove directory traversal
  let sanitized = sanitizePath(input);

  // Only allow alphanumeric, dots, dashes, underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_]/g, '_');

  // Prevent double extensions (potential exploit)
  sanitized = sanitized.replace(/\.+/g, '.');

  // Remove leading dots (hidden files)
  sanitized = sanitized.replace(/^\.+/, '');

  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  return sanitized;
}

/**
 * Sanitize MongoDB/NoSQL query
 * Prevents NoSQL injection
 */
export function sanitizeNoSQL(input: any): any {
  if (typeof input !== 'object' || input === null) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map(sanitizeNoSQL);
  }

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    // Remove MongoDB operators from keys
    if (key.startsWith('$')) {
      continue;
    }

    // Recursively sanitize nested objects
    sanitized[key] = sanitizeNoSQL(value);
  }

  return sanitized;
}

/**
 * Sanitize object keys and values
 * General-purpose object sanitization
 */
export function sanitizeObject<T extends Record<string, any>>(
  input: T,
  keySanitizer: (key: string) => string = (k) => k,
  valueSanitizer: (value: any) => any = (v) => v
): Partial<T> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(input)) {
    const sanitizedKey = keySanitizer(key);

    if (typeof value === 'string') {
      sanitized[sanitizedKey] = valueSanitizer(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[sanitizedKey] = sanitizeObject(value, keySanitizer, valueSanitizer);
    } else {
      sanitized[sanitizedKey] = value;
    }
  }

  return sanitized as Partial<T>;
}

/**
 * Sanitize JSON input
 * Safely parse and sanitize JSON
 */
export function sanitizeJSON(input: string): any {
  try {
    const parsed = JSON.parse(input);
    return sanitizeNoSQL(parsed);
  } catch {
    return null;
  }
}

/**
 * Trim and normalize whitespace
 */
export function normalizeWhitespace(input: string): string {
  if (!input) return '';

  return input
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[\r\n\t]/g, ' '); // Replace newlines and tabs with space
}

/**
 * Limit string length safely
 */
export function limitLength(input: string, maxLength: number): string {
  if (!input) return '';

  if (input.length <= maxLength) {
    return input;
  }

  return input.substring(0, maxLength);
}

/**
 * Remove null bytes (can cause issues in C-based systems)
 */
export function removeNullBytes(input: string): string {
  if (!input) return '';

  return input.replace(/\0/g, '');
}

/**
 * Comprehensive sanitization for user input
 * Combines multiple sanitization techniques
 */
export function sanitizeUserInput(input: string, options: {
  allowHTML?: boolean;
  maxLength?: number;
} = {}): string {
  if (!input) return '';

  const { allowHTML = false, maxLength = 10000 } = options;

  let sanitized = input;

  // Remove null bytes
  sanitized = removeNullBytes(sanitized);

  // Trim and normalize whitespace
  sanitized = normalizeWhitespace(sanitized);

  // Limit length
  if (maxLength) {
    sanitized = limitLength(sanitized, maxLength);
  }

  // Sanitize HTML if not allowed
  if (!allowHTML) {
    sanitized = sanitizeText(sanitized);
  } else {
    sanitized = sanitizeHTML(sanitized);
  }

  return sanitized;
}

/**
 * Validate and sanitize common data types
 */
export const sanitizers = {
  text: sanitizeText,
  html: sanitizeHTML,
  sql: sanitizeSQL,
  nosql: sanitizeNoSQL,
  path: sanitizePath,
  url: sanitizeURL,
  email: sanitizeEmail,
  phone: sanitizePhone,
  filename: sanitizeFilename,
  json: sanitizeJSON,
  userInput: sanitizeUserInput,
};

/**
 * Type-safe sanitizer
 */
export function sanitize<T = string>(
  input: string,
  type: keyof typeof sanitizers
): T | null {
  const sanitizer = sanitizers[type];
  return sanitizer(input) as T;
}
