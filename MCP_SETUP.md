# MCP Server Setup for AI DJ

## Architecture Overview

Your AI DJ now includes a Model Context Protocol (MCP) server running on Cloudflare Workers that enables Claude to make real-time Spotify API calls during conversations.

## How It Works

1. **User Login**: When a user logs in with Spotify, a session token is generated
2. **Session Storage**: Session token → Spotify token mapping is stored in Cloudflare KV
3. **Claude Integration**: Claude receives the MCP server URL and session token
4. **Tool Calling**: Claude can call Spotify tools directly through the MCP server
5. **Token Security**: Spotify tokens never leave the worker, only session tokens are shared

## Session Flow

```mermaid
graph LR
    A[User Login] --> B[Generate Session Token]
    B --> C[Store in KV]
    C --> D[Pass to Claude]
    D --> E[Claude Makes Tool Calls]
    E --> F[MCP Server Validates]
    F --> G[Execute Spotify API]
    G --> H[Return to Claude]
```

## Available MCP Tools

Claude can now call these tools in real-time:

- **search_spotify_tracks**: Search with audio feature filters
- **get_audio_features**: Analyze track characteristics
- **get_recommendations**: Get AI-powered recommendations
- **create_playlist**: Create new playlists
- **modify_playlist**: Add/remove/reorder tracks
- **analyze_playlist**: Deep dive into playlist characteristics

## MCP Endpoints

### Session Management
- `POST /api/mcp/session/create` - Create session after Spotify login
- `POST /api/mcp/session/destroy` - Destroy session on logout

### MCP Protocol
- `POST /api/mcp/initialize` - Initialize MCP connection
- `POST /api/mcp/tools/list` - List available tools
- `POST /api/mcp/tools/call` - Execute a tool
- `POST /api/mcp/resources/list` - List playlists as resources
- `POST /api/mcp/resources/read` - Read playlist details

## Frontend Integration

```typescript
// After Spotify login
const response = await fetch('/api/mcp/session/create', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${spotifyToken}`
  }
});

const { sessionToken, mcpServerUrl } = await response.json();

// Configure Claude with MCP
const claudeConfig = {
  tools: 'auto',
  mcp_servers: {
    spotify: {
      url: mcpServerUrl,
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    }
  }
};
```

## Security Features

- **Session Expiry**: 4-hour TTL on all sessions
- **Token Isolation**: Spotify tokens never exposed to client
- **Bearer Auth**: All MCP endpoints require session token
- **Automatic Cleanup**: KV TTL handles expired sessions

## Deployment

The MCP server is already configured and ready:

```bash
# Deploy to production
pnpm run deploy

# Test locally
pnpm run dev
```

## KV Namespaces

Production and preview namespaces are already created:
- Production ID: `c81455430c6d4aa2a5da4bf2c1fcd3a2`
- Preview ID: `859d29ec06564975a30d67be3a960b89`

## Testing the MCP Server

1. Login with Spotify to get a token
2. Create a session:
```bash
curl -X POST https://dj.current.space/api/mcp/session/create \
  -H "Authorization: Bearer YOUR_SPOTIFY_TOKEN"
```

3. Use the returned `sessionToken` to test MCP tools:
```bash
curl -X POST https://dj.current.space/api/mcp/tools/list \
  -H "Authorization: Bearer SESSION_TOKEN"
```

## Benefits

- **Real-time Tool Calling**: Claude can search, analyze, and create iteratively
- **Better Context Management**: No need to pre-fetch all data
- **Secure Token Handling**: Spotify tokens stay server-side
- **Scalable Architecture**: Cloudflare Workers handle any load
- **Standard Protocol**: MCP is becoming the standard for AI tool integration

## What This Enables

Now when chatting with Claude, it can:
1. Search for tracks and immediately check their audio features
2. Try multiple searches to find the perfect match
3. Create playlists iteratively, adding tracks one by one
4. Analyze existing playlists on-demand
5. Make decisions based on real-time data

Example conversation:
```
User: "Create a workout playlist"
Claude: [Searches for high-energy tracks]
Claude: [Checks tempo is 120-140 BPM]
Claude: [Gets recommendations based on findings]
Claude: [Creates playlist with verified tracks]
Claude: "I've created your workout playlist with 15 high-energy tracks!"
```

The MCP server transforms Claude from a one-shot responder to an iterative music curator!