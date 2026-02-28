/**
 * guards.ts Tests
 * Tests for type guards and safe parsing utilities
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  createErrorResponse,
  createTypeGuard,
  formatZodError,
  isSuccessResponse,
  isValidHttpStatus,
  parse,
  safeParse,
} from '../../lib/guards'

describe('Type Guards', () => {
  it('createTypeGuard() creates working type predicate', () => {
    const schema = z.object({ age: z.number(), name: z.string() })
    const isValid = createTypeGuard(schema)

    expect(isValid({ age: 30, name: 'John' })).toBe(true)
    expect(isValid({ age: 'thirty', name: 'John' })).toBe(false)
    expect(isValid({ age: 30, name: 123 })).toBe(false)
    expect(isValid(null)).toBe(false)
  })

  it('createTypeGuard() returns false on invalid data', () => {
    const schema = z.array(z.number())
    const isValid = createTypeGuard(schema)

    expect(isValid([1, 2, 3])).toBe(true)
    expect(isValid([1, 'two', 3])).toBe(false)
    expect(isValid('not an array')).toBe(false)
  })

  it('createTypeGuard() handles nested schemas', () => {
    const schema = z.object({
      user: z.object({
        email: z.string().email(),
        name: z.string(),
      }),
    })
    const isValid = createTypeGuard(schema)

    expect(isValid({ user: { email: 'john@example.com', name: 'John' } })).toBe(true)
    expect(isValid({ user: { email: 'invalid', name: 'John' } })).toBe(false)
  })

  it('createTypeGuard() validates optional fields', () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    })
    const isValid = createTypeGuard(schema)

    expect(isValid({ name: 'John' })).toBe(true)
    expect(isValid({ name: 'John', nickname: 'Johnny' })).toBe(true)
    expect(isValid({ name: 'John', nickname: 123 })).toBe(false)
  })
})

describe('Safe Parsing', () => {
  it('safeParse() returns success for valid data', () => {
    const schema = z.object({ name: z.string() })
    const result = safeParse(schema, { name: 'test' })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'test' })
    expect(result.error).toBeNull()
  })

  it('safeParse() returns error for invalid data', () => {
    const schema = z.object({ name: z.string() })
    const result = safeParse(schema, { name: 123 })

    expect(result.success).toBe(false)
    expect(result.data).toBeNull()
    expect(result.error).toBeTruthy()
    expect(result.error?.issues).toBeDefined()
  })

  it('formatZodError() formats errors readably', () => {
    const schema = z.object({ age: z.number(), name: z.string() })
    const result = schema.safeParse({ age: 'old', name: 123 })

    if (result.error) {
      const formatted = formatZodError(result.error)
      expect(formatted).toContain('name')
      expect(formatted).toContain('age')
      expect(formatted.length).toBeGreaterThan(0)
    }
  })

  it('formatZodError() handles single error', () => {
    const schema = z.object({ email: z.string().email() })
    const result = schema.safeParse({ email: 'not-an-email' })

    if (result.error) {
      const formatted = formatZodError(result.error)
      expect(formatted).toContain('email')
    }
  })

  it('formatZodError() includes error messages', () => {
    const schema = z.object({ value: z.number().positive() })
    const result = schema.safeParse({ value: -5 })

    if (result.error) {
      const formatted = formatZodError(result.error)
      expect(formatted.length).toBeGreaterThan(0)
    }
  })
})

describe('HTTP Status Validation', () => {
  it('isValidHttpStatus() accepts valid status codes', () => {
    expect(isValidHttpStatus(200)).toBe(true)
    expect(isValidHttpStatus(201)).toBe(true)
    expect(isValidHttpStatus(400)).toBe(true)
    expect(isValidHttpStatus(401)).toBe(true)
    expect(isValidHttpStatus(404)).toBe(true)
    expect(isValidHttpStatus(500)).toBe(true)
  })

  it('isValidHttpStatus() rejects invalid status codes', () => {
    expect(isValidHttpStatus(100)).toBe(false)
    expect(isValidHttpStatus(99)).toBe(false)
    expect(isValidHttpStatus(600)).toBe(false)
    expect(isValidHttpStatus(999)).toBe(false)
    expect(isValidHttpStatus(0)).toBe(false)
    expect(isValidHttpStatus(-1)).toBe(false)
  })

  it('isSuccessResponse() checks Response ok status', () => {
    const success = new Response('ok', { status: 200 })
    const error404 = new Response('error', { status: 404 })
    const error500 = new Response('error', { status: 500 })

    expect(isSuccessResponse(success)).toBe(true)
    expect(isSuccessResponse(error404)).toBe(false)
    expect(isSuccessResponse(error500)).toBe(false)
  })

  it('createErrorResponse() creates proper error objects', () => {
    const error1 = createErrorResponse('Not found', 404)
    expect(error1).toEqual({ error: 'Not found', status: 404 })

    const error2 = createErrorResponse('Unauthorized', 401)
    expect(error2).toEqual({ error: 'Unauthorized', status: 401 })

    const error3 = createErrorResponse('Server error')
    expect(error3).toEqual({ error: 'Server error', status: 500 })
  })
})

describe('Parsing Functions', () => {
  it('parse() throws on invalid data', () => {
    const schema = z.object({ name: z.string() })

    expect(() => parse(schema, { name: 'valid' })).not.toThrow()
    expect(() => parse(schema, { name: 123 })).toThrow()
  })

  it('parse() returns data on valid input', () => {
    const schema = z.object({ name: z.string(), value: z.number() })
    const result = parse(schema, { name: 'test', value: 42 })

    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('safeParse() and parse() work with complex schemas', () => {
    const schema = z.object({
      id: z.string().uuid(),
      items: z.array(z.object({ count: z.number().positive(), name: z.string() })),
    })

    const validData = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      items: [{ count: 5, name: 'item1' }],
    }

    const safeResult = safeParse(schema, validData)
    expect(safeResult.success).toBe(true)

    const parseResult = parse(schema, validData)
    expect(parseResult).toEqual(validData)
  })
})
