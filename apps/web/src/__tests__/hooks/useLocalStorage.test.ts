import {act, renderHook} from '@testing-library/react'
import {beforeEach, describe, expect, it} from 'vitest'

import {storage, STORAGE_KEYS, useLocalStorage} from '../../hooks/useLocalStorage'

describe('storage utilities', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('get', () => {
    it('returns the fallback when the key is missing', () => {
      expect(storage.get(STORAGE_KEYS.CURRENT_PLAYLIST, 'default')).toBe('default')
    })

    it('returns parsed JSON for object values', () => {
      const value = {tracks: ['a', 'b']}
      localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify(value))
      expect(storage.get(STORAGE_KEYS.CURRENT_PLAYLIST, null)).toEqual(value)
    })

    it('returns the same reference for unchanged object values across calls', () => {
      // Required by useSyncExternalStore — repeated getSnapshot calls must
      // return the same reference or React infinite-loops on object values.
      localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify({tracks: ['a']}))
      const first = storage.get<{tracks: string[]}>(STORAGE_KEYS.CURRENT_PLAYLIST, {tracks: []})
      const second = storage.get<{tracks: string[]}>(STORAGE_KEYS.CURRENT_PLAYLIST, {tracks: []})
      expect(first).toBe(second)
    })

    it('returns a new reference after the underlying value changes', () => {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify({n: 1}))
      const first = storage.get(STORAGE_KEYS.CURRENT_PLAYLIST, null)
      localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify({n: 2}))
      const second = storage.get(STORAGE_KEYS.CURRENT_PLAYLIST, null)
      expect(first).not.toBe(second)
      expect(second).toEqual({n: 2})
    })

    it('returns the raw string when the value is not valid JSON (legacy migration)', () => {
      localStorage.setItem(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, 'plain-token-string')
      expect(storage.get<string>(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, '')).toBe('plain-token-string')
    })
  })

  describe('set', () => {
    it('JSON-stringifies object values', () => {
      const value = {a: 1}
      storage.set(STORAGE_KEYS.CURRENT_PLAYLIST, value)
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_PLAYLIST)).toBe(JSON.stringify(value))
    })

    it('JSON-stringifies string values for symmetric round-trip', () => {
      // Previously strings were stored verbatim, which broke round-trips for
      // JSON-shaped strings like "null" or "123" — set wrote those raw, and
      // get parsed them back as JSON null / number 123.
      storage.set(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, 'null')
      expect(localStorage.getItem(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY)).toBe('"null"')
      expect(storage.get<string>(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, '')).toBe('null')
    })

    it('round-trips an arbitrary string identically', () => {
      storage.set(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, 'token123')
      expect(storage.get<string>(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, '')).toBe('token123')
    })
  })

  describe('remove', () => {
    it('removes the key from localStorage', () => {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, 'foo')
      storage.remove(STORAGE_KEYS.CURRENT_PLAYLIST)
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_PLAYLIST)).toBeNull()
    })
  })

  describe('clearAll', () => {
    it('removes every key listed in STORAGE_KEYS', () => {
      Object.values(STORAGE_KEYS).forEach(key => localStorage.setItem(key, 'x'))
      storage.clearAll()
      Object.values(STORAGE_KEYS).forEach(key => {
        expect(localStorage.getItem(key)).toBeNull()
      })
    })
  })
})

describe('useLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns the fallback for an empty key', () => {
    const {result} = renderHook(() => useLocalStorage(STORAGE_KEYS.CURRENT_PLAYLIST, 'fallback'))
    expect(result.current[0]).toBe('fallback')
  })

  it('reads existing object values from localStorage without infinite-looping', () => {
    // Regression: prior implementation re-parsed JSON on every getSnapshot call,
    // returning a new object each time and triggering useSyncExternalStore's
    // "Maximum update depth exceeded" error.
    const value = {tracks: ['a']}
    localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify(value))
    const {result} = renderHook(() => useLocalStorage(STORAGE_KEYS.CURRENT_PLAYLIST, null))
    expect(result.current[0]).toEqual(value)
  })

  it('persists string updates with symmetric round-trip', () => {
    const {result} = renderHook(() => useLocalStorage<string>(STORAGE_KEYS.CURRENT_PLAYLIST, 'initial'))
    act(() => {
      result.current[1]('updated')
    })
    expect(result.current[0]).toBe('updated')
  })

  it('persists object updates and round-trips them', () => {
    const {result} = renderHook(() => useLocalStorage<null | {n: number}>(STORAGE_KEYS.CURRENT_PLAYLIST, null))
    act(() => {
      result.current[1]({n: 42})
    })
    expect(result.current[0]).toEqual({n: 42})
  })

  it('removes the key when removeValue is invoked', () => {
    localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, JSON.stringify('present'))
    const {result} = renderHook(() => useLocalStorage(STORAGE_KEYS.CURRENT_PLAYLIST, 'fallback'))
    act(() => {
      result.current[2]()
    })
    expect(localStorage.getItem(STORAGE_KEYS.CURRENT_PLAYLIST)).toBeNull()
  })

  it('supports the updater function form', () => {
    const {result} = renderHook(() => useLocalStorage<string>(STORAGE_KEYS.CURRENT_PLAYLIST, 'a'))
    act(() => {
      result.current[1]((prev: string) => prev + 'b')
    })
    expect(result.current[0]).toBe('ab')
  })
})
