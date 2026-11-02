export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = 'BAD_REQUEST',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError(`${what} not found`, 404, 'NOT_FOUND');
export const conflict = (message: string, details?: unknown) => new AppError(message, 409, 'CONFLICT', details);

/** Raised by provider adapters. `retryable` drives BullMQ retry vs. immediate failure. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
    public readonly code: string = 'PROVIDER_ERROR',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class MissingCredentialsError extends ProviderError {
  constructor(provider: string, what = 'API key') {
    super(`${provider} ${what} is not configured. Add it in AI Provider Settings.`, provider, false, undefined, 'MISSING_CREDENTIALS');
    this.name = 'MissingCredentialsError';
  }
}

export class BudgetExceededError extends Error {
  readonly code = 'BUDGET_EXCEEDED';
  constructor(message: string, public readonly details: unknown) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export class CancelledError extends Error {
  readonly code = 'CANCELLED';
  constructor(message = 'Job cancelled by user') {
    super(message);
    this.name = 'CancelledError';
  }
}
