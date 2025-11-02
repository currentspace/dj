import { z } from 'zod'

// Response helper with proper status typing
export function createErrorResponse(message: string, status: 400 | 401 | 404 | 500 = 500) {
  return { error: message, status }
}

// Generic type guard creator
export function createTypeGuard<T>(schema: z.ZodSchema<T>) {
  return (data: unknown): data is T => {
    try {
      schema.parse(data)
      return true
    } catch {
      return false
    }
  }
}

// Type predicate for checking if response is ok
export function isSuccessResponse(response: Response): response is Response & { ok: true } {
  return response.ok
}

// HTTP Status type guard
export function isValidHttpStatus(status: number): status is 200 | 201 | 400 | 401 | 404 | 500 {
  return [200, 201, 400, 401, 404, 500].includes(status)
}

// Safe parse result type
export type SafeParseResult<T> =
  | { data: null; error: z.ZodError; success: false }
  | { data: T; error: null; success: true }

// Format Zod error for logging/display
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map(err => {
      const path = err.path.join('.')
      return `${path ? `${path}: ` : ''}${err.message}`
    })
    .join(', ')
}

// Safe parser that returns SafeParseResult with error details
export function safeParse<T>(schema: z.ZodSchema<T>, data: unknown): SafeParseResult<T> {
  const result = schema.safeParse(data)

  if (result.success) {
    return {
      data: result.data,
      error: null,
      success: true,
    }
  } else {
    return {
      data: null,
      error: result.error,
      success: false,
    }
  }
}
