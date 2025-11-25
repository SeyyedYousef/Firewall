/**
 * Enhanced Local Storage Utility
 * Provides safe localStorage access with quota checking and error handling
 */

import { logError } from './errors.js';

interface StorageItem<T> {
  value: T;
  timestamp: number;
  expiresAt?: number;
}

class SafeStorage {
  private prefix: string;

  constructor(prefix = 'firewall') {
    this.prefix = prefix;
  }

  /**
   * Generate full key with prefix
   */
  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * Check if localStorage is available
   */
  isAvailable(): boolean {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get estimated quota usage
   */
  getQuotaUsage(): { used: number; total: number; percentage: number } | null {
    if (!this.isAvailable()) {
      return null;
    }

    try {
      let used = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const value = localStorage.getItem(key) || '';
          used += key.length + value.length;
        }
      }

      // Estimate total quota (usually 5-10MB, we'll use 5MB as conservative estimate)
      const total = 5 * 1024 * 1024; // 5MB in bytes
      const percentage = (used / total) * 100;

      return { used, total, percentage };
    } catch (error) {
      logError(error, { context: 'getQuotaUsage' });
      return null;
    }
  }

  /**
   * Check if there's enough space
   */
  hasEnoughSpace(dataSize: number): boolean {
    const quota = this.getQuotaUsage();
    if (!quota) {
      return true; // Assume there's space if we can't check
    }

    const remainingSpace = quota.total - quota.used;
    return dataSize < remainingSpace * 0.9; // Use only 90% of remaining space
  }

  /**
   * Set item in localStorage with error handling
   */
  setItem<T>(key: string, value: T, expiresIn?: number): boolean {
    if (!this.isAvailable()) {
      console.warn('[Storage] localStorage is not available');
      return false;
    }

    try {
      const fullKey = this.getKey(key);
      const item: StorageItem<T> = {
        value,
        timestamp: Date.now(),
        expiresAt: expiresIn ? Date.now() + expiresIn : undefined,
      };

      const serialized = JSON.stringify(item);
      const dataSize = serialized.length * 2; // UTF-16 uses 2 bytes per char

      // Check quota before writing
      if (!this.hasEnoughSpace(dataSize)) {
        console.warn('[Storage] Not enough space, cleaning old items...');
        this.cleanup();

        // Check again after cleanup
        if (!this.hasEnoughSpace(dataSize)) {
          console.error('[Storage] Still not enough space after cleanup');
          return false;
        }
      }

      localStorage.setItem(fullKey, serialized);
      return true;
    } catch (error) {
      logError(error, { context: 'setItem', key });

      // If quota exceeded, try to clean up and retry once
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('[Storage] Quota exceeded, cleaning up...');
        this.cleanup();
        
        try {
          const fullKey = this.getKey(key);
          const item: StorageItem<T> = {
            value,
            timestamp: Date.now(),
            expiresAt: expiresIn ? Date.now() + expiresIn : undefined,
          };
          localStorage.setItem(fullKey, JSON.stringify(item));
          return true;
        } catch {
          return false;
        }
      }

      return false;
    }
  }

  /**
   * Get item from localStorage with error handling
   */
  getItem<T>(key: string, defaultValue?: T): T | null {
    if (!this.isAvailable()) {
      return defaultValue ?? null;
    }

    try {
      const fullKey = this.getKey(key);
      const stored = localStorage.getItem(fullKey);

      if (!stored) {
        return defaultValue ?? null;
      }

      const item: StorageItem<T> = JSON.parse(stored);

      // Check if expired
      if (item.expiresAt && Date.now() > item.expiresAt) {
        this.removeItem(key);
        return defaultValue ?? null;
      }

      return item.value;
    } catch (error) {
      logError(error, { context: 'getItem', key });
      return defaultValue ?? null;
    }
  }

  /**
   * Remove item from localStorage
   */
  removeItem(key: string): boolean {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const fullKey = this.getKey(key);
      localStorage.removeItem(fullKey);
      return true;
    } catch (error) {
      logError(error, { context: 'removeItem', key });
      return false;
    }
  }

  /**
   * Clear all items with this prefix
   */
  clear(): boolean {
    if (!this.isAvailable()) {
      return false;
    }

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${this.prefix}:`)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
      return true;
    } catch (error) {
      logError(error, { context: 'clear' });
      return false;
    }
  }

  /**
   * Clean up expired items
   */
  cleanup(): number {
    if (!this.isAvailable()) {
      return 0;
    }

    let removed = 0;
    const now = Date.now();

    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(`${this.prefix}:`)) {
          continue;
        }

        try {
          const stored = localStorage.getItem(key);
          if (!stored) {
            continue;
          }

          const item: StorageItem<unknown> = JSON.parse(stored);

          // Remove if expired
          if (item.expiresAt && now > item.expiresAt) {
            keysToRemove.push(key);
          }
        } catch {
          // Remove corrupted items
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        removed++;
      });
    } catch (error) {
      logError(error, { context: 'cleanup' });
    }

    return removed;
  }

  /**
   * Get all keys with this prefix
   */
  keys(): string[] {
    if (!this.isAvailable()) {
      return [];
    }

    const keys: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`${this.prefix}:`)) {
          keys.push(key.replace(`${this.prefix}:`, ''));
        }
      }
    } catch (error) {
      logError(error, { context: 'keys' });
    }

    return keys;
  }
}

/**
 * Global storage instances
 */
export const storage = new SafeStorage('firewall');
export const tempStorage = new SafeStorage('firewall:temp');

/**
 * Auto cleanup on startup
 */
if (typeof window !== 'undefined') {
  storage.cleanup();
  tempStorage.cleanup();
}
