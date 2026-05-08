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

    it('returns the raw string when the value is not valid JSON', () => {
      localStorage.setItem(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, 'plain-token-string')
      expect(storage.get<string>(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, '')).toBe('plain-token-string')
    })
  })

  describe('set', () => {
    it('stringifies object values', () => {
      const value = {a: 1}
      storage.set(STORAGE_KEYS.CURRENT_PLAYLIST, value)
      expect(localStorage.getItem(STORAGE_KEYS.CURRENT_PLAYLIST)).toBe(JSON.stringify(value))
    })

    it('stores string values without re-stringifying', () => {
      storage.set(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY, 'token123')
      expect(localStorage.getItem(STORAGE_KEYS.SPOTIFY_TOKEN_LEGACY)).toBe('token123')
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
      Object.values(STORAGE_KEYS).forEach((key) => localStorage.setItem(key, 'x'))
      storage.clearAll()
      Object.values(STORAGE_KEYS).forEach((key) => {
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

  it('reads existing string values from localStorage', () => {
    localStorage.setItem(STORAGE_KEYS.CURRENT_PLAYLIST, 'a-stored-value')
    const {result} = renderHook(() => useLocalStorage<string>(STORAGE_KEYS.CURRENT_PLAYLIST, 'fallback'))
    expect(result.current[0]).toBe('a-stored-value')
  })

  it('persists string updates to localStorage as-is', () => {
    const {result} = renderHook(() => useLocalStorage<string>(STORAGE_KEYS.CURRENT_PLAYLIST, 'initial'))
    act(() => {
      result.current[1]('updated')
    })
    // storage.set passes strings through without JSON-stringifying them
    expect(localStorage.getItem(STORAGE_KEYS.CURRENT_PLAYLIST)).toBe('updated')
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
