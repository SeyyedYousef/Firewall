/**
 * Safe Async Hook
 * Provides error handling, loading states, and race condition protection for async operations
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { getErrorMessage, logError } from '../utils/errors.js';
import { rateLimiters } from '../utils/rateLimiter.js';

interface UseSafeAsyncOptions {
  onError?: (error: unknown) => void;
  onSuccess?: (data: any) => void;
  rateLimitKey?: string;
  retryCount?: number;
  retryDelay?: number;
}

interface UseSafeAsyncReturn<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (...args: any[]) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for safe async operations with error handling and loading states
 */
export function useSafeAsync<T = any>(
  asyncFunction: (...args: any[]) => Promise<T>,
  options: UseSafeAsyncOptions = {}
): UseSafeAsyncReturn<T> {
  const {
    onError,
    onSuccess,
    rateLimitKey,
    retryCount = 0,
    retryDelay = 1000,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const execute = useCallback(
    async (...args: any[]): Promise<T | null> => {
      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Check rate limit
      if (rateLimitKey) {
        try {
          await rateLimiters.api.check(rateLimitKey);
        } catch (rateLimitError) {
          const errorMessage = getErrorMessage(rateLimitError);
          setError(errorMessage);
          onError?.(rateLimitError);
          return null;
        }
      }

      // Create new abort controller
      abortControllerRef.current = new AbortController();

      if (!mountedRef.current) {
        return null;
      }

      setLoading(true);
      setError(null);

      let attempt = 0;
      const maxAttempts = retryCount + 1;

      while (attempt < maxAttempts) {
        try {
          const result = await asyncFunction(...args);

          if (!mountedRef.current) {
            return null;
          }

          setData(result);
          setLoading(false);
          onSuccess?.(result);
          return result;
        } catch (err) {
          attempt++;
          
          if (!mountedRef.current) {
            return null;
          }

          // Don't retry on abort or certain errors
          if (
            err instanceof Error && err.name === 'AbortError' ||
            attempt >= maxAttempts
          ) {
            const errorMessage = getErrorMessage(err);
            setError(errorMessage);
            setLoading(false);
            logError(err, { context: 'useSafeAsync', args });
            onError?.(err);
            return null;
          }

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }

      return null;
    },
    [asyncFunction, onError, onSuccess, rateLimitKey, retryCount, retryDelay]
  );

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return {
    data,
    loading,
    error,
    execute,
    reset,
  };
}

/**
 * Hook for safe API calls with automatic error handling
 */
export function useSafeApiCall<T = any>(
  endpoint: string,
  options: UseSafeAsyncOptions & {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
  } = {}
): UseSafeAsyncReturn<T> {
  const { method = 'GET', headers = {}, ...asyncOptions } = options;

  const apiCall = useCallback(
    async (body?: any): Promise<T> => {
      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.status} ${response.statusText}`);
      }

      return response.json();
    },
    [endpoint, method, headers]
  );

  return useSafeAsync(apiCall, {
    ...asyncOptions,
    rateLimitKey: asyncOptions.rateLimitKey || endpoint,
  });
}

/**
 * Hook for safe form submissions
 */
export function useSafeSubmit<T = any>(
  submitFunction: (data: any) => Promise<T>,
  options: UseSafeAsyncOptions = {}
): UseSafeAsyncReturn<T> & {
  submit: (data: any) => Promise<T | null>;
} {
  const safeAsync = useSafeAsync(submitFunction, {
    ...options,
    rateLimitKey: options.rateLimitKey || 'form-submit',
  });

  const submit = useCallback(
    async (data: any): Promise<T | null> => {
      return safeAsync.execute(data);
    },
    [safeAsync.execute]
  );

  return {
    ...safeAsync,
    submit,
  };
}

/**
 * Hook for debounced async operations
 */
export function useDebouncedAsync<T = any>(
  asyncFunction: (...args: any[]) => Promise<T>,
  delay = 300,
  options: UseSafeAsyncOptions = {}
): UseSafeAsyncReturn<T> {
  const timeoutRef = useRef<NodeJS.Timeout>();
  const safeAsync = useSafeAsync(asyncFunction, options);

  const debouncedExecute = useCallback(
    (...args: any[]): Promise<T | null> => {
      return new Promise((resolve) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(async () => {
          const result = await safeAsync.execute(...args);
          resolve(result);
        }, delay);
      });
    },
    [safeAsync.execute, delay]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    ...safeAsync,
    execute: debouncedExecute,
  };
}
