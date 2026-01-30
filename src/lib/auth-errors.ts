/**
 * Custom Authentication Error Class
 * Used to distinguish auth failures from other errors
 */

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Check if an error is an authentication error
 */
export function isAuthError(error: any): boolean {
  return (
    error instanceof AuthenticationError ||
    error?.name === 'AuthenticationError' ||
    error?.message?.includes('Not authenticated') ||
    error?.message?.includes('Invalid authentication') ||
    error?.message?.includes('invalid token')
  );
}

/**
 * Check if an error is an authorization error
 */
export function isAuthzError(error: any): boolean {
  return (
    error instanceof AuthorizationError ||
    error?.name === 'AuthorizationError' ||
    error?.message?.includes('not associated with a tenant') ||
    error?.message?.includes('Forbidden')
  );
}
