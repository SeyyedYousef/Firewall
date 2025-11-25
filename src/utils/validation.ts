/**
 * Input Validation Utilities
 * Provides validation functions for user inputs across the application
 */

import { ValidationError } from './errors.js';

export type ValidationRule<T> = (value: T) => string | null;

/**
 * Validate required field
 */
export function required<T>(value: T, fieldName = 'This field'): void {
  if (value === null || value === undefined || value === '') {
    throw new ValidationError(`${fieldName} is required`);
  }
}

/**
 * Validate string length
 */
export function minLength(value: string, min: number, fieldName = 'Input'): void {
  if (value.length < min) {
    throw new ValidationError(`${fieldName} must be at least ${min} characters long`);
  }
}

export function maxLength(value: string, max: number, fieldName = 'Input'): void {
  if (value.length > max) {
    throw new ValidationError(`${fieldName} must not exceed ${max} characters`);
  }
}

/**
 * Validate number range
 */
export function minValue(value: number, min: number, fieldName = 'Value'): void {
  if (value < min) {
    throw new ValidationError(`${fieldName} must be at least ${min}`);
  }
}

export function maxValue(value: number, max: number, fieldName = 'Value'): void {
  if (value > max) {
    throw new ValidationError(`${fieldName} must not exceed ${max}`);
  }
}

export function isPositive(value: number, fieldName = 'Value'): void {
  if (value <= 0) {
    throw new ValidationError(`${fieldName} must be positive`);
  }
}

/**
 * Validate Telegram User ID
 */
export function validateTelegramUserId(value: string): boolean {
  const userId = value.trim();
  
  // Must be numeric
  if (!/^\d+$/.test(userId)) {
    throw new ValidationError('User ID must contain only numbers');
  }
  
  // Parse as number
  const numericId = parseInt(userId, 10);
  
  // Must be positive
  if (numericId <= 0) {
    throw new ValidationError('User ID must be a positive number');
  }
  
  // Telegram user IDs are typically 9-10 digits
  if (userId.length < 5 || userId.length > 15) {
    throw new ValidationError('Invalid user ID format');
  }
  
  return true;
}

/**
 * Validate Telegram Chat ID
 */
export function validateTelegramChatId(value: string): boolean {
  const chatId = value.trim();
  
  // Must start with - for groups/supergroups
  if (!chatId.startsWith('-')) {
    throw new ValidationError('Chat ID must start with - (e.g., -1001234567890)');
  }
  
  // Must be numeric after the minus sign
  if (!/^-\d+$/.test(chatId)) {
    throw new ValidationError('Chat ID must be in format -1001234567890');
  }
  
  // Parse as number
  const numericId = parseInt(chatId, 10);
  
  // Must be negative
  if (numericId >= 0) {
    throw new ValidationError('Group chat ID must be negative');
  }
  
  // Typical format: -100 followed by 10 digits
  if (chatId.length < 10 || chatId.length > 20) {
    throw new ValidationError('Invalid chat ID format');
  }
  
  return true;
}

/**
 * Validate URL
 */
export function validateUrl(value: string, protocols = ['http', 'https']): boolean {
  const url = value.trim();
  
  if (!url) {
    throw new ValidationError('URL cannot be empty');
  }
  
  try {
    const parsed = new URL(url);
    
    if (!protocols.includes(parsed.protocol.replace(':', ''))) {
      throw new ValidationError(`URL must use ${protocols.join(' or ')} protocol`);
    }
    
    return true;
  } catch {
    throw new ValidationError('Invalid URL format');
  }
}

/**
 * Validate Telegram channel link
 */
export function validateTelegramChannelLink(value: string): boolean {
  const link = value.trim();
  
  if (!link) {
    throw new ValidationError('Channel link cannot be empty');
  }
  
  // Must start with https://t.me/ or t.me/
  if (!link.match(/^(https?:\/\/)?(t\.me|telegram\.me)\//)) {
    throw new ValidationError('Link must be a valid Telegram link (t.me/...)');
  }
  
  // Extract username/invite code
  const parts = link.split('/').filter(Boolean);
  const lastPart = parts[parts.length - 1];
  
  if (!lastPart) {
    throw new ValidationError('Invalid channel link format');
  }
  
  // Username should not contain special characters
  if (lastPart.startsWith('+')) {
    // Private invite link
    if (lastPart.length < 10) {
      throw new ValidationError('Invalid invite link format');
    }
  } else {
    // Public username
    if (!/^[a-zA-Z0-9_]{5,}$/.test(lastPart)) {
      throw new ValidationError('Invalid channel username');
    }
  }
  
  return true;
}

/**
 * Validate credit amount
 */
export function validateCreditAmount(value: string): number {
  const amount = value.trim();
  
  if (!amount) {
    throw new ValidationError('Credit amount cannot be empty');
  }
  
  // Must be numeric
  if (!/^\d+$/.test(amount)) {
    throw new ValidationError('Credit amount must be a number');
  }
  
  const numericAmount = parseInt(amount, 10);
  
  // Must be positive
  if (numericAmount <= 0) {
    throw new ValidationError('Credit amount must be positive');
  }
  
  // Reasonable limit (max 365 days)
  if (numericAmount > 365) {
    throw new ValidationError('Credit amount cannot exceed 365 days');
  }
  
  return numericAmount;
}

/**
 * Validate XP reward
 */
export function validateXpReward(value: string): number {
  const xp = value.trim();
  
  if (!xp) {
    throw new ValidationError('XP reward cannot be empty');
  }
  
  // Must be numeric
  if (!/^\d+$/.test(xp)) {
    throw new ValidationError('XP reward must be a number');
  }
  
  const numericXp = parseInt(xp, 10);
  
  // Must be positive
  if (numericXp <= 0) {
    throw new ValidationError('XP reward must be positive');
  }
  
  // Reasonable limit
  if (numericXp > 10000) {
    throw new ValidationError('XP reward cannot exceed 10,000');
  }
  
  return numericXp;
}

/**
 * Validate JSON input
 */
export function validateJson(value: string): any {
  const json = value.trim();
  
  if (!json) {
    throw new ValidationError('JSON cannot be empty');
  }
  
  try {
    return JSON.parse(json);
  } catch (error) {
    throw new ValidationError('Invalid JSON format');
  }
}

/**
 * Sanitize HTML input
 */
export function sanitizeHtml(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}

/**
 * Validate and sanitize text message
 */
export function validateMessage(value: string, maxLength = 4096): string {
  const message = value.trim();
  
  if (!message) {
    throw new ValidationError('Message cannot be empty');
  }
  
  if (message.length > maxLength) {
    throw new ValidationError(`Message cannot exceed ${maxLength} characters`);
  }
  
  // Telegram supports HTML tags, but we should sanitize dangerous ones
  return sanitizeHtml(message);
}

/**
 * Validate button label
 */
export function validateButtonLabel(value: string): string {
  const label = value.trim();
  
  if (!label) {
    throw new ValidationError('Button label cannot be empty');
  }
  
  if (label.length > 64) {
    throw new ValidationError('Button label cannot exceed 64 characters');
  }
  
  return label;
}

/**
 * Compose multiple validation rules
 */
export function validate<T>(
  value: T,
  ...rules: ValidationRule<T>[]
): void {
  for (const rule of rules) {
    const error = rule(value);
    if (error) {
      throw new ValidationError(error);
    }
  }
}

/**
 * Safe number parsing
 */
export function parseNumber(value: string, defaultValue = 0): number {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if value is empty
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  
  return false;
}
