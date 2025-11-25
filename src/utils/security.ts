/**
 * Security Utilities
 * Provides input sanitization, CSRF protection, and other security features
 */

import { ValidationError } from './errors.js';

/**
 * HTML sanitization - remove dangerous tags and attributes
 */
export function sanitizeHtml(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    // Remove script tags
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove iframe tags
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    // Remove object/embed tags
    .replace(/<(object|embed|form|input|textarea|select|button)\b[^>]*>/gi, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove on* event handlers
    .replace(/\s*on\w+\s*=\s*[^>\s]+/gi, '')
    // Remove data: protocol (except for images)
    .replace(/data:(?!image\/)/gi, '')
    // Remove vbscript: protocol
    .replace(/vbscript:/gi, '')
    // Remove style attributes that could contain expressions
    .replace(/style\s*=\s*[^>]*expression\s*\(/gi, '');
}

/**
 * SQL injection prevention - escape special characters
 */
export function escapeSql(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/'/g, "''")
    .replace(/"/g, '""')
    .replace(/\\/g, '\\\\')
    .replace(/\x00/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z');
}

/**
 * XSS prevention - encode HTML entities
 */
export function encodeHtml(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * URL validation and sanitization
 */
export function sanitizeUrl(url: string): string {
  if (typeof url !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(url);
    
    // Only allow safe protocols
    const allowedProtocols = ['http:', 'https:', 'mailto:', 'tel:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new ValidationError('Invalid URL protocol');
    }

    // Remove dangerous parameters
    parsed.searchParams.delete('javascript');
    parsed.searchParams.delete('vbscript');
    
    return parsed.toString();
  } catch {
    throw new ValidationError('Invalid URL format');
  }
}

/**
 * Generate CSRF token
 */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate CSRF token
 */
export function validateCsrfToken(token: string, expectedToken: string): boolean {
  if (!token || !expectedToken) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  if (token.length !== expectedToken.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < token.length; i++) {
    result |= token.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Rate limiting key generation
 */
export function generateRateLimitKey(identifier: string, action: string): string {
  return `${identifier}:${action}`;
}

/**
 * Content Security Policy headers
 */
export const CSP_HEADERS = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.telegram.org",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

/**
 * Security headers for API responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  ...CSP_HEADERS,
};

/**
 * Validate file upload
 */
export function validateFileUpload(file: File, options: {
  maxSize?: number;
  allowedTypes?: string[];
  allowedExtensions?: string[];
} = {}): void {
  const {
    maxSize = 10 * 1024 * 1024, // 10MB default
    allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  } = options;

  // Check file size
  if (file.size > maxSize) {
    throw new ValidationError(`File size exceeds ${Math.round(maxSize / 1024 / 1024)}MB limit`);
  }

  // Check MIME type
  if (!allowedTypes.includes(file.type)) {
    throw new ValidationError('Invalid file type');
  }

  // Check file extension
  const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  if (!allowedExtensions.includes(extension)) {
    throw new ValidationError('Invalid file extension');
  }

  // Additional security checks
  if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
    throw new ValidationError('Invalid file name');
  }
}

/**
 * Generate secure random string
 */
export function generateSecureId(length = 16): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(36)).join('').substring(0, length);
}

/**
 * Hash password (client-side hashing for additional security)
 */
export async function hashPassword(password: string, salt?: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + (salt || ''));
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate origin for CORS
 */
export function validateOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) {
    return false;
  }

  return allowedOrigins.some(allowed => {
    if (allowed === '*') {
      return true;
    }
    if (allowed.startsWith('*.')) {
      const domain = allowed.substring(2);
      return origin.endsWith(domain);
    }
    return origin === allowed;
  });
}

/**
 * Prevent prototype pollution
 */
export function sanitizeObject(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip dangerous keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }

    sanitized[key] = sanitizeObject(value);
  }

  return sanitized;
}

/**
 * Input length validation
 */
export function validateInputLength(
  input: string,
  fieldName: string,
  min = 0,
  max = 1000
): void {
  if (typeof input !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`);
  }

  if (input.length < min) {
    throw new ValidationError(`${fieldName} must be at least ${min} characters`);
  }

  if (input.length > max) {
    throw new ValidationError(`${fieldName} cannot exceed ${max} characters`);
  }
}

/**
 * Telegram-specific security validations
 */
export function validateTelegramData(data: any): void {
  // Validate required Telegram fields
  if (!data.id || typeof data.id !== 'number') {
    throw new ValidationError('Invalid Telegram user ID');
  }

  if (data.username && typeof data.username !== 'string') {
    throw new ValidationError('Invalid Telegram username');
  }

  if (data.first_name && typeof data.first_name !== 'string') {
    throw new ValidationError('Invalid first name');
  }

  // Sanitize text fields
  if (data.first_name) {
    data.first_name = sanitizeHtml(data.first_name);
  }

  if (data.last_name) {
    data.last_name = sanitizeHtml(data.last_name);
  }

  if (data.username) {
    data.username = data.username.replace(/[^a-zA-Z0-9_]/g, '');
  }
}

/**
 * Environment-based security settings
 */
export const SECURITY_CONFIG = {
  development: {
    allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    csrfRequired: false,
    httpsOnly: false,
  },
  production: {
    allowedOrigins: ['https://yourdomain.com'],
    csrfRequired: true,
    httpsOnly: true,
  },
} as const;

/**
 * Get security config for current environment
 */
export function getSecurityConfig() {
  const env = process.env.NODE_ENV || 'development';
  return SECURITY_CONFIG[env as keyof typeof SECURITY_CONFIG] || SECURITY_CONFIG.development;
}
