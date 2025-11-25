/**
 * Client-side Rate Limiter
 * Prevents excessive API calls and provides user feedback
 */

import { RateLimitError } from './errors.js';

interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
  keyPrefix?: string;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private requests = new Map<string, RequestRecord>();
  private config: Required<RateLimiterConfig>;

  constructor(config: RateLimiterConfig) {
    this.config = {
      keyPrefix: 'ratelimit',
      ...config,
    };
  }

  /**
   * Check if request is allowed
   */
  async check(key: string): Promise<void> {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const now = Date.now();
    
    // Clean up expired entries
    this.cleanup();
    
    const record = this.requests.get(fullKey);
    
    if (!record) {
      // First request
      this.requests.set(fullKey, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return;
    }
    
    // Check if window has expired
    if (now >= record.resetTime) {
      // Reset the counter
      this.requests.set(fullKey, {
        count: 1,
        resetTime: now + this.config.windowMs,
      });
      return;
    }
    
    // Check if limit exceeded
    if (record.count >= this.config.maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      throw new RateLimitError(
        `Too many requests. Please wait ${retryAfter} seconds.`,
        retryAfter
      );
    }
    
    // Increment counter
    record.count++;
    this.requests.set(fullKey, record);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now >= record.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Get remaining requests
   */
  getRemaining(key: string): number {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    const record = this.requests.get(fullKey);
    
    if (!record) {
      return this.config.maxRequests;
    }
    
    const now = Date.now();
    if (now >= record.resetTime) {
      return this.config.maxRequests;
    }
    
    return Math.max(0, this.config.maxRequests - record.count);
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    const fullKey = `${this.config.keyPrefix}:${key}`;
    this.requests.delete(fullKey);
  }
}

/**
 * Global rate limiters for different endpoints
 */
export const rateLimiters = {
  // API requests - 60 requests per minute
  api: new RateLimiter({
    maxRequests: 60,
    windowMs: 60 * 1000,
    keyPrefix: 'api',
  }),
  
  // Mission completion - 10 per minute
  missionComplete: new RateLimiter({
    maxRequests: 10,
    windowMs: 60 * 1000,
    keyPrefix: 'mission',
  }),
  
  // Reward redemption - 5 per minute
  rewardRedeem: new RateLimiter({
    maxRequests: 5,
    windowMs: 60 * 1000,
    keyPrefix: 'reward',
  }),
  
  // Group actions - 20 per minute
  groupAction: new RateLimiter({
    maxRequests: 20,
    windowMs: 60 * 1000,
    keyPrefix: 'group',
  }),
  
  // Search - 30 per minute
  search: new RateLimiter({
    maxRequests: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'search',
  }),
};

/**
 * Throttle function - limit function execution rate
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (timeSinceLastCall >= delay) {
      lastCall = now;
      func.apply(this, args);
    } else {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func.apply(this, args);
      }, delay - timeSinceLastCall);
    }
  };
}

/**
 * Debounce function - delay function execution
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (this: any, ...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

/**
 * Create a rate-limited version of an async function
 */
export function rateLimit<T extends (...args: any[]) => Promise<any>>(
  func: T,
  limiter: RateLimiter,
  key: string
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  return async function (this: any, ...args: Parameters<T>): Promise<ReturnType<T>> {
    await limiter.check(key);
    return func.apply(this, args);
  };
}

/**
 * Hook-compatible debounce (for React)
 */
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  return debounce(callback, delay);
}

/**
 * Hook-compatible throttle (for React)
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  return throttle(callback, delay);
}
