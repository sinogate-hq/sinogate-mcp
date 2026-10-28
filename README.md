# SinoGate MCP Server

Use DeepSeek, Kimi (Moonshot), Qwen, GLM, MiniMax, and other models in SinoGate from Claude Desktop, Claude Code, Cursor, Cline, and MCP-compatible clients. Requests use the OpenAI-compatible SinoGate API.

Each chat and comparison call uses your own `SINOGATE_API_KEY`. SinoGate bills those requests to your account.

## Tools

- `sinogate_chat` — Send a prompt or conversation to one model. Returns the completion and usage information.
- `sinogate_list_models` — List enabled models, capabilities, and current public USD prices. Filter by provider.
- `sinogate_compare` — Run one prompt against two to four models in parallel and compare answers, latency, and token usage.

Prices come from SinoGate's public model catalog. The authoritative pricing page is [sinogate.ai/docs/models-pricing](https://sinogate.ai/docs/models-pricing).

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
| `SINOGATE_API_KEY` | Yes | — | Your SinoGate API key. Chat and comparison requests are billed to your account. |
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
