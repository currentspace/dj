# MCP Integration Testing Guide

## Problem Identified
LangChain's ChatAnthropic doesn't automatically connect to MCP servers. We need explicit tool calling integration.

## Solution Implemented
Created `/api/chat-mcp/message` endpoint that:
1. Uses Anthropic SDK directly (not LangChain)
2. Defines tools explicitly to Claude
3. Executes tool calls through our internal MCP implementation
4. Provides comprehensive logging

## Testing the Integration

### 1. Test Tool Execution Directly
```bash
# First, test that our tools work
curl -X POST https://dj.current.space/api/chat-mcp/test-tools \
  -H "Authorization: Bearer YOUR_SPOTIFY_TOKEN" \
  -H "Content-Type: application/json"
```

Expected logs:
```
[Test:abc123] === TOOL TEST STARTED ===
[Test:abc123] Testing search_spotify_tracks...
[Tool] Executing search_spotify_tracks with args: {"query":"test search","limit":3}
[Tool] search_spotify_tracks completed successfully in 182ms
[Test:abc123] Search completed, found 3 tracks
[Test:abc123] Testing get_audio_features...
[Test:abc123] === TOOL TEST COMPLETE ===
```

### 2. Test Chat with Tool Calling
```bash
curl -X POST https://dj.current.space/api/chat-mcp/message \
  -H "Authorization: Bearer YOUR_SPOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Search for some upbeat workout tracks and analyze their energy levels",
    "mode": "analyze"
  }'
```

Expected behavior:
1. Claude calls `search_spotify_tracks` with workout-related query
2. Claude calls `get_audio_features` on returned tracks
3. Claude provides analysis based on real data

Expected logs:
```
[Chat:def456] === NEW CHAT REQUEST ===
[Chat:def456] Mode: analyze, Message: "Search for some upbeat workout tracks..."
[Chat:def456] Calling Claude with 1 messages and 6 tools
[Chat:def456] Tool call requested: search_spotify_tracks
[Tool] Executing search_spotify_tracks with args: {"query":"upbeat workout","limit":10}
[Tool] search_spotify_tracks completed successfully in 245ms
[Chat:def456] Tool search_spotify_tracks completed successfully
[Chat:def456] Tool call requested: get_audio_features
[Tool] Executing get_audio_features with args: {"track_ids":["abc","def","ghi"]}
[Tool] get_audio_features completed successfully in 156ms
[Chat:def456] Making follow-up call to Claude with 2 tool results
[Chat:def456] === CHAT COMPLETE === (2840ms, 2 tools used)
```

### 3. Test Playlist Creation
```bash
curl -X POST https://dj.current.space/api/chat-mcp/message \
  -H "Authorization: Bearer YOUR_SPOTIFY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a chill study playlist with 8 tracks",
    "mode": "create"
  }'
```

Expected behavior:
1. Claude searches for chill tracks
2. Claude checks audio features for low energy/high focus
3. Claude creates actual Spotify playlist
4. Returns playlist link

## Monitoring Logs

Run this while testing:
```bash
pnpm exec wrangler tail dj --format pretty --search "[Chat:"
```

Or filter by specific test:
```bash
pnpm exec wrangler tail dj --format pretty --search "[Test:"
```

## Key Differences from Previous Approach

### Before (LangChain):
- LangChain managed tool calling
- No direct MCP server integration
- Tools were separate from MCP server
- No observable tool execution

### After (Direct Integration):
- Anthropic SDK with explicit tool definitions
- Tools execute through our MCP implementation
- Full E2E logging and observability
- Real tool calling with actual results

## Expected Response Format

Successful chat response:
```json
{
  "message": "I found 10 upbeat workout tracks with an average energy of 0.82...",
  "conversationHistory": [...],
  "toolsUsed": ["search_spotify_tracks", "get_audio_features"],
  "executionTime": 2840,
  "requestId": "def456"
}
```

## Troubleshooting

If no tool calls appear:
1. Check Claude is receiving tool definitions
2. Verify system prompts encourage tool usage
3. Ensure tool execution isn't failing silently
4. Check logs for tool call attempts