import { z } from 'zod';

// Generic type guard creator
export function createTypeGuard<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): data is T => {
    try {
      schema.parse(data);
      return true;
    } catch {
      return false;
    }
  };
}

// Safe parser that returns parsed data or null
export function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): T | null {
  try {
    return schema.parse(data);
  } catch (error) {
    console.warn('Schema validation failed:', error);
    return null;
  }
}

// HTTP Status type guard
export function isValidHttpStatus(status: number): status is 200 | 201 | 400 | 401 | 404 | 500 {
  return [200, 201, 400, 401, 404, 500].includes(status);
}

// Response helper with proper status typing
export function createErrorResponse(message: string, status: 400 | 401 | 404 | 500 = 500) {
  return { error: message, status };
}

// Type predicate for checking if response is ok
export function isSuccessResponse(response: Response): response is Response & { ok: true } {
  return response.ok;
}