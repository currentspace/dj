/**
 * LoggerContext.ts Tests
 * Tests for AsyncLocalStorage-based logger context
 */

import { describe, expect, it, vi } from 'vitest'

import { getChildLogger, getLogger, runWithLogger } from '../../utils/LoggerContext'
import { ServiceLogger } from '../../utils/ServiceLogger'

describe('LoggerContext', () => {
  it('getLogger() returns undefined outside of context', () => {
    const logger = getLogger()
    // Outside of runWithLogger context, should be undefined
    expect(logger).toBeUndefined()
  })

  it('runWithLogger() establishes logger context', async () => {
    const testLogger = new ServiceLogger('TestService')
    let contextLogger: ServiceLogger | undefined

    await runWithLogger(testLogger, async () => {
      contextLogger = getLogger()
    })

    expect(contextLogger).toBeDefined()
    expect(contextLogger?.constructor.name).toBe('ServiceLogger')
  })

  it('getChildLogger() throws outside of context', () => {
    expect(() => getChildLogger('subContext')).toThrow('getChildLogger called outside of logger context')
  })

  it('getChildLogger() creates child logger within context', async () => {
    const testLogger = new ServiceLogger('Parent')

    await runWithLogger(testLogger, async () => {
      const childLogger = getChildLogger('Child')
      expect(childLogger).toBeDefined()
      expect(childLogger.constructor.name).toBe('ServiceLogger')
    })
  })

  it('runWithLogger() preserves context across async operations', async () => {
    const testLogger = new ServiceLogger('AsyncTest')
    const loggers: (ServiceLogger | undefined)[] = []

    await runWithLogger(testLogger, async () => {
      loggers.push(getLogger())
      await new Promise(resolve => setTimeout(resolve, 10))
      loggers.push(getLogger())
      await new Promise(resolve => setTimeout(resolve, 10))
      loggers.push(getLogger())
    })

    // All three should be the same logger instance
    expect(loggers[0]).toBeDefined()
    expect(loggers[1]).toBeDefined()
    expect(loggers[2]).toBeDefined()
  })

  it('runWithLogger() returns function result', async () => {
    const testLogger = new ServiceLogger('ResultTest')
    const expectedValue = { data: 'test' }

    const result = await runWithLogger(testLogger, async () => {
      return expectedValue
    })

    expect(result).toEqual(expectedValue)
  })

  it('runWithLogger() propagates errors from function', async () => {
    const testLogger = new ServiceLogger('ErrorTest')

    await expect(
      runWithLogger(testLogger, async () => {
        throw new Error('Test error')
      }),
    ).rejects.toThrow('Test error')
  })

  it('child logger has correct service name format', async () => {
    const testLogger = new ServiceLogger('Parent')
    let childLogger: ServiceLogger | undefined

    await runWithLogger(testLogger, async () => {
      childLogger = getChildLogger('Child')
    })

    // Verify it's a valid ServiceLogger instance
    expect(childLogger).toBeDefined()
    expect(childLogger?.constructor.name).toBe('ServiceLogger')
  })

  it('multiple runWithLogger calls maintain separate contexts', async () => {
    const logger1 = new ServiceLogger('Service1')
    const logger2 = new ServiceLogger('Service2')

    let context1Logger: ServiceLogger | undefined
    let context2Logger: ServiceLogger | undefined

    await runWithLogger(logger1, async () => {
      context1Logger = getLogger()
    })

    await runWithLogger(logger2, async () => {
      context2Logger = getLogger()
    })

    expect(context1Logger).toBeDefined()
    expect(context2Logger).toBeDefined()
    expect(context1Logger?.constructor.name).toBe('ServiceLogger')
    expect(context2Logger?.constructor.name).toBe('ServiceLogger')
  })
})

describe('LoggerContext - ServiceLogger Integration', () => {
  it('logger context can perform logging operations', async () => {
    const testLogger = new ServiceLogger('IntegrationTest')
    const spyInfo = vi.spyOn(testLogger, 'info')
    const spyError = vi.spyOn(testLogger, 'error')

    await runWithLogger(testLogger, async () => {
      const logger = getLogger()
      logger?.info('test message')
      logger?.error('error message')
    })

    expect(spyInfo).toHaveBeenCalled()
    expect(spyError).toHaveBeenCalled()

    spyInfo.mockRestore()
    spyError.mockRestore()
  })

  it('child logger inherits from parent context', async () => {
    const parentLogger = new ServiceLogger('Parent')

    let childLogger: ServiceLogger | undefined

    await runWithLogger(parentLogger, async () => {
      childLogger = getChildLogger('Child')
    })

    expect(childLogger).toBeDefined()
    expect(childLogger?.constructor.name).toBe('ServiceLogger')
  })
})
