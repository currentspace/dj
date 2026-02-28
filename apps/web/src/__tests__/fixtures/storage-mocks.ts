/**
 * localStorage and sessionStorage Mock Infrastructure
 * Provides in-memory storage mocks with full Web Storage API compliance
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface StorageCall {
  args: unknown[]
  method: 'clear' | 'getItem' | 'key' | 'removeItem' | 'setItem'
  timestamp: number
}

export interface TokenData {
  createdAt: number
  expiresAt: null | number
  token: string
}

// ============================================================================
// STORAGE MOCK IMPLEMENTATION
// ============================================================================

/**
 * In-memory storage implementation that mimics localStorage/sessionStorage
 * Fully compliant with Web Storage API spec
 */
export class MockStorage implements Storage {
  get length(): number {
    return this.store.size
  }

  private store = new Map<string, string>()

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): null | string {
    return this.store.get(key) ?? null
  }

  key(index: number): null | string {
    const keys = Array.from(this.store.keys())
    return keys[index] ?? null
  }

  /**
   * Get all stored keys (helper for testing)
   */
  keys(): string[] {
    return Array.from(this.store.keys())
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }

  /**
   * Get snapshot of entire storage (helper for testing)
   */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store)
  }
}

// ============================================================================
// GLOBAL STORAGE SETUP
// ============================================================================

/**
 * Spy on storage operations (tracks all calls)
 */
export class StorageSpy {
  private calls: StorageCall[] = []
  private originalStorage: Storage

  constructor(storage: Storage) {
    this.originalStorage = storage
  }

  /**
   * Clear recorded calls
   */
  clearCalls(): void {
    this.calls = []
  }

  /**
   * Get all recorded calls
   */
  getCalls(): StorageCall[] {
    return [...this.calls]
  }

  /**
   * Get calls of a specific method
   */
  getCallsFor(method: StorageCall['method']): StorageCall[] {
    return this.calls.filter(call => call.method === method)
  }

  /**
   * Install the spy (wraps all storage methods)
   */
  install(): Storage {
    const originalStorage = this.originalStorage
    return {
      clear: () => {
        this.recordCall('clear', [])
        originalStorage.clear()
      },

      getItem: (key: string) => {
        this.recordCall('getItem', [key])
        return originalStorage.getItem(key)
      },

      key: (index: number) => {
        this.recordCall('key', [index])
        return originalStorage.key(index)
      },

      get length() {
        return originalStorage.length
      },

      removeItem: (key: string) => {
        this.recordCall('removeItem', [key])
        originalStorage.removeItem(key)
      },

      setItem: (key: string, value: string) => {
        this.recordCall('setItem', [key, value])
        originalStorage.setItem(key, value)
      },
    }
  }

  /**
   * Check if a method was called with specific arguments
   */
  wasCalledWith(method: StorageCall['method'], args: unknown[]): boolean {
    return this.calls.some(call => call.method === method && this.argsMatch(call.args, args))
  }

  private argsMatch(recorded: unknown[], expected: unknown[]): boolean {
    if (recorded.length !== expected.length) return false
    return recorded.every((arg, i) => arg === expected[i])
  }

  private recordCall(method: StorageCall['method'], args: unknown[]): void {
    this.calls.push({
      args,
      method,
      timestamp: Date.now(),
    })
  }
}

/**
 * Clear all storage (localStorage + sessionStorage)
 */
export function clearAllStorage(): void {
  localStorage.clear()
  sessionStorage.clear()
}

// ============================================================================
// TOKEN DATA HELPERS
// ============================================================================

export function clearMockTokenFromLocalStorage(): void {
  localStorage.removeItem('spotify_token_data')
  localStorage.removeItem('spotify_token')
}

export function createExpiredTokenData(): TokenData {
  return {
    createdAt: Date.now() - 7200000, // 2 hours ago
    expiresAt: Date.now() - 3600000, // 1 hour ago (expired)
    token: 'expired_token_12345',
  }
}

export function createMockTokenData(overrides?: Partial<TokenData>): TokenData {
  return {
    createdAt: Date.now(),
    expiresAt: Date.now() + 3600000, // 1 hour from now
    token: 'mock_spotify_token_12345',
    ...overrides,
  }
}

// ============================================================================
// SEEDING HELPERS
// ============================================================================

/**
 * Create a storage spy
 */
export function createStorageSpy(storage: Storage = localStorage): {
  getCalls: () => StorageCall[]
  getCallsFor: (method: StorageCall['method']) => StorageCall[]
  storage: Storage
  wasCalledWith: (method: StorageCall['method'], args: unknown[]) => boolean
} {
  const spy = new StorageSpy(storage)
  const spiedStorage = spy.install()

  return {
    getCalls: () => spy.getCalls(),
    getCallsFor: (method: StorageCall['method']) => spy.getCallsFor(method),
    storage: spiedStorage,
    wasCalledWith: (method: StorageCall['method'], args: unknown[]) => spy.wasCalledWith(method, args),
  }
}

export function createTokenDataWithoutExpiry(): TokenData {
  return {
    createdAt: Date.now(),
    expiresAt: null,
    token: 'token_without_expiry_12345',
  }
}

/**
 * Assert that a localStorage key exists
 */
export function expectLocalStorageKey(key: string): void {
  const value = localStorage.getItem(key)
  if (value === null) {
    throw new Error(`Expected localStorage key "${key}" to exist, but it was not found`)
  }
}

/**
 * Assert that a localStorage key does NOT exist
 */
export function expectNoLocalStorageKey(key: string): void {
  const value = localStorage.getItem(key)
  if (value !== null) {
    throw new Error(`Expected localStorage key "${key}" to NOT exist, but it was found with value: ${value}`)
  }
}

/**
 * Get parsed JSON from localStorage
 */
export function getLocalStorageJSON<T = unknown>(key: string): null | T {
  const value = localStorage.getItem(key)
  if (value === null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

// ============================================================================
// RETRIEVAL HELPERS
// ============================================================================

export function getMockTokenDataFromLocalStorage(): null | TokenData {
  const stored = localStorage.getItem('spotify_token_data')
  if (!stored) return null
  try {
    return JSON.parse(stored) as TokenData
  } catch {
    return null
  }
}

/**
 * Get parsed JSON from sessionStorage
 */
export function getSessionStorageJSON<T = unknown>(key: string): null | T {
  const value = sessionStorage.getItem(key)
  if (value === null) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/**
 * Seed localStorage with test data
 */
export function seedLocalStorage(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

// ============================================================================
// VERIFICATION HELPERS
// ============================================================================

/**
 * Seed sessionStorage with test data
 */
export function seedSessionStorage(data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }
}

export function setLegacyTokenInLocalStorage(token: string): void {
  localStorage.setItem('spotify_token', token)
}

// ============================================================================
// STORAGE EVENT SIMULATION
// ============================================================================

export function setMockTokenInLocalStorage(tokenData?: Partial<TokenData>): void {
  const data = createMockTokenData(tokenData)
  const value = JSON.stringify(data)
  localStorage.setItem('spotify_token_data', value)
}

// ============================================================================
// STORAGE SPY (for tracking calls)
// ============================================================================

/**
 * Install mock storage globally (replaces window.localStorage/sessionStorage)
 */
export function setupMockStorage(): {
  localStorage: MockStorage
  sessionStorage: MockStorage
} {
  const mockLocalStorage = new MockStorage()
  const mockSessionStorage = new MockStorage()

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: mockLocalStorage,
    writable: true,
  })

  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: mockSessionStorage,
    writable: true,
  })

  return {localStorage: mockLocalStorage, sessionStorage: mockSessionStorage}
}

/**
 * Trigger storage event (simulates cross-tab synchronization)
 */
export function triggerStorageEvent(key: string, newValue: null | string, oldValue: null | string = null): void {
  const event = new StorageEvent('storage', {
    key,
    newValue,
    oldValue,
    storageArea: localStorage,
    url: window.location.href,
  })
  window.dispatchEvent(event)
}

// ============================================================================
// PRE-MADE STORAGE SCENARIOS
// ============================================================================

/**
 * Common storage scenarios for testing
 */
export const STORAGE_SCENARIOS = {
  /**
   * Authenticated user with valid token
   */
  authenticated: () => {
    setMockTokenInLocalStorage()
  },

  /**
   * Empty storage (logged out)
   */
  empty: () => {
    clearAllStorage()
  },

  /**
   * Expired token scenario
   */
  expired: () => {
    const expiredData = createExpiredTokenData()
    localStorage.setItem('spotify_token_data', JSON.stringify(expiredData))
  },

  /**
   * Legacy token format (for migration testing)
   */
  legacy: () => {
    setLegacyTokenInLocalStorage('legacy_token_abc123')
  },

  /**
   * User with saved preferences
   */
  withPreferences: () => {
    seedLocalStorage({
      spotify_token_data: createMockTokenData(),
      user_preferences: {
        theme: 'dark',
        volume: 0.8,
      },
    })
  },
}
