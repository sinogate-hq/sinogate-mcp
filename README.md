# SinoGate MCP Server

Use DeepSeek, Kimi (Moonshot), Qwen, GLM, MiniMax, image, and video models in SinoGate from Claude Desktop, Claude Code, Cursor, Cline, and MCP-compatible clients. Requests use the OpenAI-compatible SinoGate API.

Each generation call uses your own `SINOGATE_API_KEY`. SinoGate bills those requests to your account.

## Tools

### Chat
- `sinogate_chat` — Send a prompt or conversation to one model. Returns the completion and usage information.
- `sinogate_list_models` — List enabled models, capabilities, and public USD prices. Filter by `provider` and/or `modality` (`chat` / `image` / `video` / `vision`).
- `sinogate_compare` — Run one prompt against two to four models in parallel and compare answers, latency, and token usage.

### Image
- `sinogate_generate_image` — Synchronous text-to-image. Returns temporary URL(s) or base64. SinoGate does not store images (~24h URLs).
- `sinogate_edit_image` — Synchronous reference-image edit (`POST /v1/images/edits`). Accepts data URL or SinoGate asset HTTPS URL (no mask inpainting).

### Video (async; no hidden polling)
- `sinogate_submit_video` — Submit a job; returns `id` immediately. Supports optional `callback_url`, `image_url` (i2v), `extra`, and `idempotency_key`.
- `sinogate_get_video_status` — Poll status (`queued` → `running` → `succeeded` / `failed` / `expired` / `cancelled`).
- `sinogate_list_videos` — List recent (24h) video jobs with optional `status` filter and pagination.
- `sinogate_cancel_video` — Cancel an upstream queued (pending) video job and release its credit hold.
- `sinogate_download_video` — When succeeded, return temporary `url` and `content_url`. Does not stream MP4 into the agent context.

**Agent contract:** this server does not wait for video completion and does not auto-resubmit on timeout. The client decides polling and retries.

Prices come from SinoGate's public model catalog. The authoritative pricing page is [sinogate.ai/docs/models-pricing](https://sinogate.ai/docs/models-pricing). OpenAPI for import: [api.sinogate.ai/openapi.json](https://api.sinogate.ai/openapi.json).

## Requirements

- Node.js 20 or later
- A SinoGate account and API key from [sinogate.ai](https://sinogate.ai)

## Claude Desktop

Add this server to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sinogate": {
      "command": "npx",
      "args": ["-y", "@sinogate/mcp"],
      "env": {
        "SINOGATE_API_KEY": "sk-sg-your-key"
      }
    }
  }
}
```

Restart Claude Desktop after saving the configuration.

## Cursor

Add the same server entry to your Cursor MCP configuration (`~/.cursor/mcp.json`).

## Claude Code

```sh
claude mcp add sinogate -e SINOGATE_API_KEY=sk-sg-your-key -- npx -y @sinogate/mcp
```

Other stdio MCP clients can launch `npx -y @sinogate/mcp` and provide the environment variable in their MCP server settings.

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SINOGATE_API_KEY` | Yes | — | Your SinoGate API key. Chat, image, and video requests are billed to your account. |
| `SINOGATE_BASE_URL` | No | `https://api.sinogate.ai/v1` | API base URL. `https://sinogate.ai/v1` is also supported. For local development, HTTP is allowed on localhost. |

The server sends `Authorization: Bearer <key>` only to the configured SinoGate API host. It does not log the key. The list models tool reads public model and pricing data.

## Run from source

```sh
npm install
npm run build
SINOGATE_API_KEY=sk-sg-your-key node dist/index.js
```

On PowerShell, set the key for the current session with `$env:SINOGATE_API_KEY = "sk-sg-your-key"` before running Node.

## License

MIT
