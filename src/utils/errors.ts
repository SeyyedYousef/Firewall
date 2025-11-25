/**
 * Centralized Error Management System
 * Provides consistent error handling and user-friendly messages across the app
 */

export class AppError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number,
    public isOperational = true
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NetworkError extends AppError {
  constructor(message = 'Network request failed. Please check your connection.') {
    super(message, 'NETWORK_ERROR', 0, true);
    this.name = 'NetworkError';
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid input provided.', public field?: string) {
    super(message, 'VALIDATION_ERROR', 400, true);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed. Please try again.') {
    super(message, 'AUTH_ERROR', 401, true);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 'AUTHORIZATION_ERROR', 403, true);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(message, 'NOT_FOUND', 404, true);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.', public retryAfter?: number) {
    super(message, 'RATE_LIMIT_ERROR', 429, true);
    this.name = 'RateLimitError';
  }
}

export class ServerError extends AppError {
  constructor(message = 'Server error occurred. Please try again.') {
    super(message, 'SERVER_ERROR', 500, false);
    this.name = 'ServerError';
  }
}

/**
 * Error Messages - User-friendly error messages
 */
export const ERROR_MESSAGES = {
  // Network errors
  NETWORK_OFFLINE: 'You appear to be offline. Please check your internet connection.',
  NETWORK_TIMEOUT: 'Request timed out. Please try again.',
  NETWORK_ERROR: 'Network error occurred. Please check your connection and try again.',
  
  // API errors
  API_ERROR: 'Failed to communicate with the server. Please try again.',
  API_TIMEOUT: 'Server is taking too long to respond. Please try again.',
  
  // Auth errors
  AUTH_REQUIRED: 'Please log in to continue.',
  AUTH_FAILED: 'Authentication failed. Please try again.',
  AUTH_EXPIRED: 'Your session has expired. Please refresh the page.',
  
  // Permission errors
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  OWNER_ONLY: 'This action is only available to the bot owner.',
  ADMIN_ONLY: 'This action requires admin privileges.',
  
  // Validation errors
  INVALID_INPUT: 'Invalid input provided. Please check and try again.',
  REQUIRED_FIELD: 'This field is required.',
  INVALID_FORMAT: 'Invalid format. Please check your input.',
  INVALID_NUMBER: 'Please enter a valid number.',
  INVALID_URL: 'Please enter a valid URL.',
  
  // Resource errors
  NOT_FOUND: 'The requested resource was not found.',
  GROUP_NOT_FOUND: 'Group not found. Please check the ID and try again.',
  USER_NOT_FOUND: 'User not found.',
  
  // State errors
  ALREADY_EXISTS: 'This item already exists.',
  ALREADY_COMPLETED: 'This action has already been completed.',
  NOT_AVAILABLE: 'This feature is not currently available.',
  
  // Storage errors
  STORAGE_FULL: 'Storage quota exceeded. Please clear some data.',
  STORAGE_ERROR: 'Failed to save data. Please try again.',
  
  // Rate limit
  RATE_LIMIT: 'Too many requests. Please wait a moment and try again.',
  
  // Generic
  UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.',
  TRY_AGAIN: 'Something went wrong. Please try again.',
  REFRESH_PAGE: 'Please refresh the page and try again.',
} as const;

/**
 * Get user-friendly error message from error object
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.message;
  }
  
  if (error instanceof Error) {
    // Map common error messages
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return ERROR_MESSAGES.NETWORK_ERROR;
    }
    if (error.message.includes('timeout')) {
      return ERROR_MESSAGES.NETWORK_TIMEOUT;
    }
    if (error.message.includes('permission') || error.message.includes('auth')) {
      return ERROR_MESSAGES.PERMISSION_DENIED;
    }
    
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

/**
 * Log error to console with context
 */
export function logError(error: unknown, context?: Record<string, any>): void {
  const timestamp = new Date().toISOString();
  const errorMessage = getErrorMessage(error);
  
  console.error('[Error]', {
    timestamp,
    message: errorMessage,
    error: error instanceof Error ? error : new Error(String(error)),
    context,
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/**
 * Handle API response errors
 */
export function handleApiError(response: Response): never {
  if (!response.ok) {
    switch (response.status) {
      case 400:
        throw new ValidationError('Invalid request. Please check your input.');
      case 401:
        throw new AuthenticationError();
      case 403:
        throw new AuthorizationError();
      case 404:
        throw new NotFoundError();
      case 429:
        throw new RateLimitError();
      case 500:
      case 502:
      case 503:
      case 504:
        throw new ServerError();
      default:
        throw new AppError(`Request failed with status ${response.status}`);
    }
  }
  
  throw new AppError('Unknown API error');
}

/**
 * Retry function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  initialDelay = 1000
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on certain errors
      if (error instanceof ValidationError || error instanceof AuthorizationError) {
        throw error;
      }
      
      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}
