/**
 * Validation utilities for type-safe JSON parsing
 * Uses Zod for runtime validation with TypeScript inference
 */

import { z } from 'zod';

/**
 * Safe parse result that preserves type information
 */
export type SafeParseResult<T> =
  | { data: T; error: null; success: true }
  | { data: null; error: z.ZodError; success: false };

/**
 * Safely parse data with Zod schema
 * Returns typed result or null with error details
 */
export function safeParse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): SafeParseResult<z.infer<T>> {
  const result = schema.safeParse(data);

  if (result.success) {
    return {
      data: result.data,
      error: null,
      success: true,
    };
  } else {
    return {
      data: null,
      error: result.error,
      success: false,
    };
  }
}

/**
 * Parse data with Zod schema or throw detailed error
 * Use when you want to crash fast on invalid data
 */
export function parse<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown
): z.infer<T> {
  return schema.parse(data);
}

/**
 * Validate JSON response from fetch
 * Returns typed data or throws ValidationError
 *
 * Note: Response type from Web API (available in browsers and workers)
 */
export async function parseJsonResponse<T extends z.ZodTypeAny>(
  response: { json(): Promise<unknown>; ok: boolean; status: number; statusText: string },
  schema: T
): Promise<z.infer<T>> {
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const json = await response.json();
  return parse(schema, json);
}

/**
 * Safely validate JSON response from fetch
 * Returns SafeParseResult with error details
 *
 * Note: Response type from Web API (available in browsers and workers)
 */
export async function safeParseJsonResponse<T extends z.ZodTypeAny>(
  response: { json(): Promise<unknown>; ok: boolean; status: number; statusText: string },
  schema: T
): Promise<SafeParseResult<z.infer<T>>> {
  try {
    if (!response.ok) {
      return {
        data: null,
        error: new z.ZodError([
          {
            code: 'custom',
            message: `HTTP ${response.status}: ${response.statusText}`,
            path: [],
          },
        ]),
        success: false,
      };
    }

    const json = await response.json();
    return safeParse(schema, json);
  } catch (error) {
    return {
      data: null,
      error: new z.ZodError([
        {
          code: 'custom',
          message: error instanceof Error ? error.message : 'Unknown error',
          path: [],
        },
      ]),
      success: false,
    };
  }
}

/**
 * Create a type guard from a Zod schema
 */
export function createTypeGuard<T extends z.ZodTypeAny>(
  schema: T
): (value: unknown) => value is z.infer<T> {
  return (value: unknown): value is z.infer<T> => {
    return schema.safeParse(value).success;
  };
}

/**
 * Format Zod error for logging/display
 */
export function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join('.');
      return `${path ? `${path}: ` : ''}${err.message}`;
    })
    .join(', ');
}
