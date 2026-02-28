/**
 * Frontend Constants
 * Centralized magic numbers and configuration values
 */

// =============================================================================
// TIMING CONSTANTS
// =============================================================================

/** Timing values in milliseconds */
export const TIMING = {
  /** Debounce delay for vibe controls energy level slider */
  DEBOUNCE_MS: 300,
  /** Minimum interval between rapid API calls (NowPlaying debounce) */
  FETCH_DEBOUNCE_MS: 500,
  /** Polling interval for playback state updates */
  PLAYBACK_POLLING_INTERVAL_MS: 1000,
  /** Delay before fetching updated state after playback action */
  PLAYBACK_REFRESH_DELAY_MS: 300,
  /** Polling interval for mix session updates */
  POLLING_INTERVAL_MS: 2000,
  /** Preview playback duration for track previews */
  PREVIEW_DURATION_MS: 10000,
  /** Simulated loading delay for suggestions refresh */
  SUGGESTIONS_LOADING_DELAY_MS: 500,
} as const

// =============================================================================
// BUFFER & SIZE LIMITS
// =============================================================================

/** Size limits in bytes */
export const LIMITS = {
  /** Chunk preview length for logging */
  CHUNK_PREVIEW_LENGTH: 200,
  /** Maximum error text slice length for display */
  ERROR_TEXT_SLICE_LENGTH: 300,
  /** Maximum SSE buffer size (2MB safety cap) */
  MAX_BUFFER_SIZE: 2 * 1024 * 1024,
} as const

// =============================================================================
// UI CONSTANTS
// =============================================================================

/** UI-related configuration */
export const UI = {
  /** Max energy level for vibe controls */
  MAX_ENERGY_LEVEL: 10,
  /** Percentage multiplier for progress/energy display */
  PERCENTAGE_MULTIPLIER: 100,
  /** Number of skeleton items to show in playlist loading state */
  SKELETON_ITEMS_COUNT: 10,
} as const

// =============================================================================
// HTTP STATUS CODES
// =============================================================================

/** HTTP status codes */
export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  INTERNAL_SERVER_ERROR: 500,
  NO_CONTENT: 204,
  NOT_FOUND: 404,
  OK: 200,
  UNAUTHORIZED: 401,
} as const
