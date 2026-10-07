import { InternalServerErrorException } from '@nestjs/common';

export class OutlineCorruptError extends Error {
  readonly filePath: string;
  constructor(filePath: string, message: string, options?: { cause?: unknown }) {
    super(`outline store corrupt at ${filePath}: ${message}`);
    this.name = 'OutlineCorruptError';
    this.filePath = filePath;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

// Maps store errors to HTTP. Rethrows unknown errors untouched.
export function toHttpException(err: unknown): Error {
  if (err instanceof OutlineCorruptError) {
    throw new InternalServerErrorException({
      error: 'outline_corrupt',
      hint: 'outline.json is not valid. Fix the file by hand or POST /api/outline/reset to restore the seed.',
      detail: err.message,
    });
  }
  throw err as Error;
}
