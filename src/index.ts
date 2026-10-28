#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import {
  DEFAULT_BASE_URL,
  messageOf,
  SinoGateClient,
  type ChatMessage,
  type ChatRequest,
} from './sinogate-client.js'

const apiKey = process.env.SINOGATE_API_KEY?.trim() ?? ''
const baseUrl = process.env.SINOGATE_BASE_URL?.trim() || DEFAULT_BASE_URL

if (!apiKey) {
  console.error('SinoGate MCP requires SINOGATE_API_KEY. Set it in your MCP client configuration.')
  process.exit(1)
}

let client: SinoGateClient
try {
  client = new SinoGateClient(apiKey, baseUrl)
} catch (error) {
  console.error(messageOf(error))
  process.exit(1)
}

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(100_000),
  name: z.string().max(128).optional(),
  tool_call_id: z.string().max(256).optional(),
})

const chatOptions = {
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(131_072).optional(),
  thinking: z.boolean().optional(),
}

function createServer() {
  const server = new McpServer({
    name: 'sinogate-mcp',
    version: '0.1.0',
  })
  registerTools(server)
  return server
}

function registerTools(server: McpServer) {
server.registerTool(
  'sinogate_chat',
  {
    title: 'Chat with a SinoGate model',
    description: 'Send a prompt or conversation to a SinoGate model such as DeepSeek, Kimi, Qwen, GLM, or MiniMax. Uses the configured SinoGate API key and returns the answer and token usage.',
    inputSchema: {
      model: z.string().min(1).max(256).describe('SinoGate model ID from sinogate_list_models, for example qwen3.7-plus.'),
      prompt: z.string().min(1).max(100_000).optional().describe('A single user prompt. Use this or messages.'),
      messages: z.array(messageSchema).min(1).max(100).optional().describe('Conversation messages. Use this or prompt.'),
      ...chatOptions,
    },
  },
  async ({ model, prompt, messages, temperature, max_tokens, thinking }) => {
    if (!prompt && !messages?.length) {
      return errorResult('Provide either prompt or at least one message.')
    }

    const request: ChatRequest = {
      model,
      messages: (messages ?? [{ role: 'user', content: prompt! }]) as ChatMessage[],
      ...(temperature === undefined ? {} : { temperature }),
      ...(max_tokens === undefined ? {} : { max_tokens }),
      ...(thinking === undefined ? {} : { enable_thinking: thinking }),
    }

    try {
      const response = await client.chat(request)
      return jsonResult({ model: response.model || model, response })
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_list_models',
  {
    title: 'List SinoGate models and prices',
    description: 'List currently available SinoGate models, modalities, thinking support, and public USD prices. Optionally filter by provider such as deepseek, kimi, qwen, glm, or minimax. Prices link to the official pricing page.',
    inputSchema: {
      provider: z.string().min(1).max(64).optional().describe('Optional provider filter, for example qwen or deepseek.'),
    },
  },
  async ({ provider }) => {
    try {
      const result = await client.listModels(provider)
      return jsonResult({
        ...result,
        ...(result.pricingAvailable ? {} : {
          pricingNote: 'The public price feed could not be loaded. Check current prices at https://sinogate.ai/docs/models-pricing.',
        }),
      })
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_compare',
  {
    title: 'Compare SinoGate models',
    description: 'Run the same prompt against 2 to 4 SinoGate model IDs in parallel. Returns each answer, latency, and token usage; calls are billed to the configured account.',
    inputSchema: {
      prompt: z.string().min(1).max(100_000).describe('Prompt to send unchanged to each model.'),
      models: z.array(z.string().min(1).max(256)).min(2).max(4).describe('Two to four SinoGate model IDs.'),
      ...chatOptions,
    },
  },
  async ({ prompt, models, temperature, max_tokens, thinking }) => {
    if (new Set(models).size !== models.length) {
      return errorResult('Choose distinct model IDs for comparison.')
    }

    const results = await Promise.all(models.map(async (model) => {
      const startedAt = performance.now()
      const request: ChatRequest = {
        model,
        messages: [{ role: 'user', content: prompt }],
        ...(temperature === undefined ? {} : { temperature }),
        ...(max_tokens === undefined ? {} : { max_tokens }),
        ...(thinking === undefined ? {} : { enable_thinking: thinking }),
      }

      try {
        const response = await client.chat(request)
        const choice = response.choices?.[0]
        return {
          model: response.model || model,
          answer: choice?.message?.content ?? '',
          latency_ms: Math.round(performance.now() - startedAt),
          usage: response.usage ?? null,
          finish_reason: choice?.finish_reason ?? null,
        }
      } catch (error) {
        return {
          model,
          error: messageOf(error),
          latency_ms: Math.round(performance.now() - startedAt),
        }
      }
    }))

    const failedCount = results.filter((item) => 'error' in item).length
    return {
      content: [{ type: 'text', text: JSON.stringify({ results }, null, 2) }],
      ...(failedCount === results.length ? { isError: true } : {}),
    }
  },
)

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

}

void serveStdio(createServer)
