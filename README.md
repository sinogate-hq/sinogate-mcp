# SinoGate / 深空渡 MCP Server

Use DeepSeek, Kimi (Moonshot), Qwen, GLM, MiniMax, image, and video models from **SinoGate** (overseas) or **深空渡** (China) in Claude Desktop, Claude Code, Cursor, Cline, and other MCP clients. Requests use the OpenAI-compatible API.

Each generation call uses your own API key. The matching site bills those requests to your account.

## Tools

### Chat
- `sinogate_chat` — Send a prompt or conversation to one model. Returns the completion and usage information.
- `sinogate_list_models` — List enabled models, capabilities, and public prices. Filter by `provider` and/or `modality` (`chat` / `image` / `video` / `vision`).
- `sinogate_compare` — Run one prompt against two to four models in parallel and compare answers, latency, and token usage.

### Image
- `sinogate_generate_image` — Synchronous text-to-image. Returns temporary URL(s) or base64. Images are not stored (~24h URLs).
- `sinogate_edit_image` — Synchronous reference-image edit (`POST /v1/images/edits`). Accepts data URL or platform asset HTTPS URL (no mask inpainting).

### Video (async; no hidden polling)
- `sinogate_submit_video` — Submit a job; returns `id` immediately. Supports optional `callback_url`, `image_url` (i2v), `extra`, and `idempotency_key`.
- `sinogate_get_video_status` — Poll status (`queued` → `running` → `succeeded` / `failed` / `expired` / `cancelled`).
- `sinogate_list_videos` — List recent (24h) video jobs with optional `status` filter and pagination.
- `sinogate_cancel_video` — Cancel an upstream queued (pending) video job and release its credit hold.
- `sinogate_download_video` — When succeeded, return temporary `url` and `content_url`. Does not stream MP4 into the agent context.

**Agent contract:** this server does not wait for video completion and does not auto-resubmit on timeout. The client decides polling and retries.

Tool names keep the `sinogate_*` prefix for compatibility; the same package talks to either site via Base URL / key.

Prices come from the public model catalog of the configured site:

| Site | Portal | Default API | Pricing |
| --- | --- | --- | --- |
| SinoGate (overseas) | [sinogate.ai](https://sinogate.ai) | `https://api.sinogate.ai/v1` | [models-pricing](https://sinogate.ai/docs/models-pricing) |
| 深空渡 (China) | [shenkongdu.com](https://shenkongdu.com) | `https://api.shenkongdu.com/v1` | [models-pricing](https://shenkongdu.com/docs/models-pricing) |

OpenAPI: [api.sinogate.ai/openapi.json](https://api.sinogate.ai/openapi.json) · [api.shenkongdu.com/openapi.json](https://api.shenkongdu.com/openapi.json)

## Requirements

- Node.js 20 or later
- An API key from [sinogate.ai](https://sinogate.ai) or [shenkongdu.com](https://shenkongdu.com)

## Claude Desktop / Cursor — overseas (SinoGate)

```json
{
  "mcpServers": {
    "sinogate": {
      "command": "npx",
      "args": ["-y", "@sinogate/mcp@0.2.2"],
      "env": {
        "SINOGATE_API_KEY": "sk-sg-your-key"
      }
    }
  }
}
```

## Claude Desktop / Cursor — China (深空渡)

Either use the 深空渡 key alias (defaults to the domestic API):

```json
{
  "mcpServers": {
    "shenkongdu": {
      "command": "npx",
      "args": ["-y", "@sinogate/mcp@0.2.2"],
      "env": {
        "SHENKONGDU_API_KEY": "skd-your-key"
      }
    }
  }
}
```

Or keep `SINOGATE_API_KEY` and set the domestic Base URL explicitly:

```json
{
  "mcpServers": {
    "shenkongdu": {
      "command": "npx",
      "args": ["-y", "@sinogate/mcp@0.2.2"],
      "env": {
        "SINOGATE_API_KEY": "skd-your-key",
        "SINOGATE_BASE_URL": "https://api.shenkongdu.com/v1"
      }
    }
  }
}
```

Restart the client after saving.

## Claude Code

Overseas:

```sh
claude mcp add sinogate -e SINOGATE_API_KEY=sk-sg-your-key -- npx -y @sinogate/mcp@0.2.2
```

深空渡:

```sh
claude mcp add shenkongdu -e SHENKONGDU_API_KEY=skd-your-key -- npx -y @sinogate/mcp@0.2.2
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SINOGATE_API_KEY` | One of the keys | — | Overseas SinoGate API key. |
| `SHENKONGDU_API_KEY` | One of the keys | — | Domestic 深空渡 API key. If set **without** `SINOGATE_API_KEY`, Base URL defaults to `https://api.shenkongdu.com/v1`. |
| `SINOGATE_BASE_URL` | No | See below | API base URL (`…/v1` or origin). |
| `SHENKONGDU_BASE_URL` | No | — | Alias for `SINOGATE_BASE_URL`. |

Default Base URL:

- `https://api.sinogate.ai/v1` when using `SINOGATE_API_KEY` (or no domestic-only key)
- `https://api.shenkongdu.com/v1` when only `SHENKONGDU_API_KEY` is set

`https://sinogate.ai/v1` and `https://shenkongdu.com/v1` are also accepted. For local development, HTTP is allowed on localhost.

The server sends `Authorization: Bearer <key>` only to the configured API host. It does not log the key. The list models tool reads public model and pricing data from the matching portal host.

## Run from source

```sh
npm install
npm run build
SINOGATE_API_KEY=sk-sg-your-key node dist/index.js
# or
SHENKONGDU_API_KEY=skd-your-key node dist/index.js
```

On PowerShell, set the key for the current session with `$env:SINOGATE_API_KEY = "sk-sg-your-key"` (or `$env:SHENKONGDU_API_KEY`) before running Node.

## License

MIT
