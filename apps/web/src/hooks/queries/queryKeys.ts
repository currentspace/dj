export const queryKeys = {
  mix: {
    session: () => ['mix', 'session'] as const,
    suggestions: () => ['mix', 'suggestions'] as const,
  },
  player: {
    queue: (token: null | string) => ['player', 'queue', {token}] as const,
  },
  spotify: {
    devices: (token: null | string) => ['spotify', 'devices', {token}] as const,
    playlists: (token: null | string) => ['spotify', 'playlists', {token}] as const,
    scopes: () => ['spotify', 'scopes'] as const,
  },
}
