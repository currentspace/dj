/**
 * Centralized localStorage utilities and React hook
 *
 * This module provides:
 * 1. Type-safe storage keys as constants
 * 2. Storage utilities for non-hook contexts (API clients, etc.)
 * 3. A React hook for component state synced with localStorage
 */

import {useCallback, useSyncExternalStore} from 'react'

// ============================================================================
// STORAGE KEYS - Single source of truth for all localStorage keys
// ============================================================================

export const STORAGE_KEYS = {
  /** Current playlist being viewed/edited (JSON) */
  CURRENT_PLAYLIST: 'current_playlist',
  /** Spotify token data with expiry info (JSON: {token, expiresAt, createdAt}) */
  SPOTIFY_TOKEN_DATA: 'spotify_token_data',
  /** Legacy Spotify token format (deprecated, used only for cleanup) */
  SPOTIFY_TOKEN_LEGACY: 'spotify_token',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]

// ============================================================================
// STORAGE UTILITIES - For non-hook contexts (API clients, services, etc.)
// ============================================================================

/**
 * Check if we're in a browser environment with localStorage available
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && 'localStorage' in window
}

/**
 * Type-safe localStorage utilities for use outside React components
 *
 * @example
 * // In an API client
 * const token = storage.get(STORAGE_KEYS.SPOTIFY_TOKEN_DATA, null)
 * storage.set(STORAGE_KEYS.SPOTIFY_TOKEN_DATA, tokenData)
 * storage.remove(STORAGE_KEYS.SPOTIFY_TOKEN_DATA)
 */
export const storage = {
  /**
   * Clear all app-related keys from localStorage
   */
  clearAll(): void {
    if (!isBrowser()) {
      return
    }

    Object.values(STORAGE_KEYS).forEach(key => {
      try {
        localStorage.removeItem(key)
      } catch {
        // Ignore errors during cleanup
      }
    })
  },

  /**
   * Get a value from localStorage with type safety
   * Automatically parses JSON for object values
   */
  get<T>(key: StorageKey, fallback: T): T {
    if (!isBrowser()) {
      return fallback
    }

    try {
      const item = localStorage.getItem(key)
      if (item === null) {
        return fallback
      }

      // Try to parse as JSON, fall back to raw value if not valid JSON
      try {
        return JSON.parse(item) as T
      } catch {
        // Not JSON, return as-is (for string values)
        return item as T
      }
    } catch {
      return fallback
    }
  },

  /**
   * Get raw string value from localStorage without JSON parsing
   */
  getRaw(key: StorageKey): null | string {
    if (!isBrowser()) {
      return null
    }

    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },

  /**
   * Check if a key exists in localStorage
   */
  has(key: StorageKey): boolean {
    if (!isBrowser()) {
      return false
    }

    try {
      return localStorage.getItem(key) !== null
    } catch {
      return false
    }
  },

  /**
   * Remove a key from localStorage
   */
  remove(key: StorageKey): void {
    if (!isBrowser()) {
      return
    }

    try {
      localStorage.removeItem(key)
    } catch (error) {
      console.error(`Failed to remove localStorage key "${key}":`, error)
    }
  },

  /**
   * Set a value in localStorage
   * Objects are automatically serialized to JSON
   */
  set<T>(key: StorageKey, value: T): void {
    if (!isBrowser()) {
      return
    }

    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value)
      localStorage.setItem(key, serialized)
    } catch (error) {
      console.error(`Failed to set localStorage key "${key}":`, error)
    }
  },
}

// ============================================================================
// CROSS-TAB SYNC - Event emitter for storage changes
// ============================================================================

type StorageListener = (key: StorageKey, newValue: null | string) => void

const storageListeners = new Map<StorageKey, Set<StorageListener>>()

/**
 * React hook for state that's synced with localStorage
 *
 * Features:
 * - SSR safe (returns initial value during SSR)
 * - Cross-tab sync (updates when other tabs change the value)
 * - Type-safe with generics
 *
 * @example
 * const [playlist, setPlaylist, removePlaylist] = useLocalStorage(
 *   STORAGE_KEYS.CURRENT_PLAYLIST,
 *   null
 * )
 */
export function useLocalStorage<T>(
  key: StorageKey,
  initialValue: T,
): [T, (value: ((prev: T) => T) | T) => void, () => void] {
  // Create a stable snapshot getter
  const getSnapshot = useCallback((): T => {
    return storage.get(key, initialValue)
  }, [key, initialValue])

  // SSR fallback
  const getServerSnapshot = useCallback((): T => {
    return initialValue
  }, [initialValue])

  // Subscribe to changes
  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      return subscribeToStorage(key, () => {
        onStoreChange()
      })
    },
    [key],
  )

  // Use useSyncExternalStore for optimal React 18+ integration
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Setter that updates localStorage and notifies listeners
  const setValue = useCallback(
    (valueOrUpdater: ((prev: T) => T) | T) => {
      const newValue = typeof valueOrUpdater === 'function' ? (valueOrUpdater as (prev: T) => T)(value) : valueOrUpdater

      storage.set(key, newValue)
      notifyStorageChange(key, typeof newValue === 'string' ? newValue : JSON.stringify(newValue))
    },
    [key, value],
  )

  // Remover that clears the key
  const removeValue = useCallback(() => {
    storage.remove(key)
    notifyStorageChange(key, null)
  }, [key])

  return [value, setValue, removeValue]
}

/**
 * Notify listeners of a storage change (for same-tab updates)
 */
function notifyStorageChange(key: StorageKey, newValue: null | string): void {
  storageListeners.get(key)?.forEach(listener => listener(key, newValue))
}

// Listen for cross-tab storage events
if (isBrowser()) {
  window.addEventListener('storage', event => {
    if (event.key && Object.values(STORAGE_KEYS).includes(event.key as StorageKey)) {
      const key = event.key as StorageKey
      storageListeners.get(key)?.forEach(listener => listener(key, event.newValue))
    }
  })
}

// ============================================================================
// REACT HOOK - For component state synced with localStorage
// ============================================================================

/**
 * Subscribe to storage changes for a specific key
 * Handles both same-tab and cross-tab changes
 */
function subscribeToStorage(key: StorageKey, listener: StorageListener): () => void {
  if (!storageListeners.has(key)) {
    storageListeners.set(key, new Set())
  }
  storageListeners.get(key)!.add(listener)

  return () => {
    storageListeners.get(key)?.delete(listener)
  }
}
