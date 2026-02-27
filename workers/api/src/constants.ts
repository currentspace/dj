/**
 * Backend Constants
 * Centralized magic numbers and configuration values for API worker
 */

// =============================================================================
// RATE LIMITS
// =============================================================================

/** Global rate limit configuration (Cloudflare Workers constraint) */
export const RATE_LIMITS = {
  /** Global requests per second (Cloudflare Workers constraint) */
  GLOBAL_RPS: 40,
  /** Jitter in milliseconds for rate limiter */
  JITTER_MS: 5,
  /** Minimum tick delay in milliseconds */
  MIN_TICK_MS: 2,
} as const

/** Per-lane concurrency limits */
export const CONCURRENCY_LIMITS = {
  /** Anthropic SDK limitation in Workers */
  ANTHROPIC: 2,
  /** Deezer API concurrent requests */
  DEEZER: 10,
  /** Default concurrent requests */
  DEFAULT: 3,
  /** Last.fm API concurrent requests */
  LASTFM: 10,
  /** Spotify API concurrent requests */
  SPOTIFY: 5,
} as const

// =============================================================================
// CACHE TTL VALUES
// =============================================================================

/** Cache TTL values in seconds */
export const CACHE_TTL = {
  /** Deezer enrichment cache hit (90 days) */
  DEEZER_HIT_SECONDS: 90 * 24 * 60 * 60,
  /** Last.fm cache hit (7 days) */
  LASTFM_HIT_SECONDS: 7 * 24 * 60 * 60,
  /** MusicBrainz ISRC cache (30 days) */
  MUSICBRAINZ_SECONDS: 30 * 24 * 60 * 60,
  /** Last.fm correction cache (30 days) */
  LASTFM_CORRECTION_SECONDS: 30 * 24 * 60 * 60,
  /** Cache miss retry interval (5 minutes) */
  MISS_SECONDS: 5 * 60,
  /** Playlist tracks cache (5 minutes) */
  PLAYLIST_TRACKS_SECONDS: 5 * 60,
} as const

// =============================================================================
// ENRICHMENT LIMITS
// =============================================================================

/** Track enrichment limits (Cloudflare Workers subrequest cap) */
export const ENRICHMENT_LIMITS = {
  /** Maximum tracks to enrich via Deezer per request */
  MAX_DEEZER_TRACKS: 100,
  /** Maximum tracks to enrich via Last.fm per request (200 tracks x 4 calls = 800 API calls) */
  MAX_LASTFM_TRACKS: 200,
  /** Maximum Cloudflare Workers subrequests (paid tier: 1000, safety margin: 950) */
  MAX_SUBREQUESTS: 950,
  /** Reserved subrequests for other operations */
  RESERVED_SUBREQUESTS: 10,
  /** Reserved subrequests for Last.fm operations */
  LASTFM_RESERVED_SUBREQUESTS: 5,
  /** Percentage of remaining budget for Deezer (50%) */
  DEEZER_BUDGET_PERCENTAGE: 0.5,
} as const

// =============================================================================
// PAGINATION LIMITS
// =============================================================================

/** Pagination configuration */
export const PAGINATION = {
  /** Default page size for track fetching */
  DEFAULT_LIMIT: 20,
  /** Maximum tracks per Spotify API request */
  MAX_SPOTIFY_TRACKS: 100,
  /** Maximum tracks per batch request */
  MAX_BATCH_TRACKS: 50,
  /** Maximum items in queue */
  MAX_QUEUE_SIZE: 10,
  /** Spotify playlist tracks batch size */
  SPOTIFY_ADD_TRACKS_BATCH: 100,
} as const

// =============================================================================
// LLM CONFIGURATION
// =============================================================================

/** LLM (Claude) configuration */
export const LLM = {
  /** Claude Sonnet model for tool calls and main conversation */
  MODEL: 'claude-sonnet-4-6-20260219',
  /** Claude Haiku model for quick tasks (progress narrator, vibe steering) */
  MODEL_HAIKU: 'claude-haiku-4-5-20251001',
  /** Max tokens for vibe extraction/planning */
  MAX_TOKENS_VIBE: 2000,
  /** Max tokens for main conversation */
  MAX_TOKENS_CONVERSATION: 10000,
  /** Extended thinking budget tokens */
  THINKING_BUDGET_TOKENS: 5000,
  /** Max tokens for follow-up responses */
  MAX_TOKENS_FOLLOWUP: 5000,
  /** Maximum agentic turns to prevent infinite loops */
  MAX_TURNS: 5,
} as const

// =============================================================================
// STREAMING CONFIGURATION
// =============================================================================

/** SSE streaming configuration */
export const STREAMING = {
  /** SSE heartbeat interval in milliseconds */
  HEARTBEAT_INTERVAL_MS: 15000,
  /** Transform stream high water mark */
  HIGH_WATER_MARK: 10,
} as const

// =============================================================================
// CONTENT LIMITS
// =============================================================================

/** Content size limits */
export const CONTENT_LIMITS = {
  /** Maximum message length */
  MAX_MESSAGE_LENGTH: 2000,
  /** Maximum playlist description length */
  MAX_DESCRIPTION_LENGTH: 300,
  /** Maximum playlist name length */
  MAX_PLAYLIST_NAME_LENGTH: 100,
  /** Maximum seed tracks/artists for recommendations */
  MAX_SEEDS: 5,
  /** Maximum tags for tag-based discovery */
  MAX_TAGS: 5,
  /** Similar tracks limit for discovery */
  MAX_SIMILAR_TRACKS: 20,
  /** Preview length for logging JSON */
  JSON_PREVIEW_LENGTH: 200,
  /** Message preview length for logging */
  MESSAGE_PREVIEW_LENGTH: 100,
  /** Error stack lines to include */
  ERROR_STACK_LINES: 10,
} as const

// =============================================================================
// BPM VALIDATION
// =============================================================================

/** BPM validation range */
export const BPM_RANGE = {
  /** Minimum valid BPM */
  MIN: 45,
  /** Maximum valid BPM */
  MAX: 220,
} as const

// =============================================================================
// DURATION MATCHING
// =============================================================================

/** Duration matching tolerance (for ISRC matching) */
export const DURATION_MATCH = {
  /** Maximum duration difference in milliseconds for MusicBrainz matching */
  TOLERANCE_MS: 10000,
} as const

// =============================================================================
// AGGREGATION LIMITS
// =============================================================================

/** Limits for aggregated data */
export const AGGREGATION = {
  /** Maximum crowd tags to return */
  MAX_CROWD_TAGS: 15,
  /** Maximum similar tracks to aggregate */
  MAX_SIMILAR_TRACKS: 10,
  /** Maximum genres to return */
  MAX_GENRES: 5,
  /** Maximum top artists in analysis */
  MAX_TOP_ARTISTS: 5,
  /** Maximum sample tracks in analysis */
  MAX_SAMPLE_TRACKS: 5,
  /** Maximum artist tags */
  MAX_ARTIST_TAGS: 10,
  /** Maximum similar artists */
  MAX_SIMILAR_ARTISTS: 10,
  /** Maximum queue preview items */
  MAX_QUEUE_PREVIEW: 10,
} as const

// =============================================================================
// VIBE SETTINGS
// =============================================================================

/** Default vibe settings */
export const VIBE_DEFAULTS = {
  /** Default vibe score for user-added tracks */
  USER_TRACK_VIBE_SCORE: 50,
  /** Default recommendation target values */
  TARGET_DANCEABILITY: 0.5,
  TARGET_ENERGY: 0.5,
  TARGET_VALENCE: 0.5,
  /** Blend weight for user updates (100%) */
  USER_UPDATE_WEIGHT: 1.0,
} as const

// =============================================================================
// HTTP STATUS CODES
// =============================================================================

/** HTTP status codes */
export const HTTP_STATUS = {
  OK: 200,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const

// =============================================================================
// PROGRESS REPORTING
// =============================================================================

/** Progress reporting configuration */
export const PROGRESS = {
  /** Minimum interval between progress messages in milliseconds */
  MIN_INTERVAL_MS: 5000,
  /** Report progress every N artists */
  ARTIST_REPORT_INTERVAL: 10,
} as const
