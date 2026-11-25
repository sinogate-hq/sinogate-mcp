#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { z } from 'zod'
import {
  DEFAULT_BASE_URL,
  DOMESTIC_DEFAULT_BASE_URL,
  messageOf,
  SinoGateClient,
  type ChatMessage,
  type ChatRequest,
} from './sinogate-client.js'

const apiKey =
  process.env.SINOGATE_API_KEY?.trim()
  || process.env.SHENKONGDU_API_KEY?.trim()
  || ''
const explicitBaseUrl =
  process.env.SINOGATE_BASE_URL?.trim()
  || process.env.SHENKONGDU_BASE_URL?.trim()
  || ''
// Prefer domestic API when only a 深空渡 key is provided.
const baseUrl = explicitBaseUrl
  || (process.env.SHENKONGDU_API_KEY?.trim() && !process.env.SINOGATE_API_KEY?.trim()
    ? DOMESTIC_DEFAULT_BASE_URL
    : DEFAULT_BASE_URL)

if (!apiKey) {
  console.error(
    'MCP requires SINOGATE_API_KEY or SHENKONGDU_API_KEY. Set it in your MCP client configuration.',
  )
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
    version: '0.2.2',
  })
  registerTools(server)
  return server
}

function registerTools(server: McpServer) {
server.registerTool(
  'sinogate_chat',
  {
    title: 'Chat with a model',
    description: 'Send a prompt or conversation to a SinoGate / 深空渡 model such as DeepSeek, Kimi, Qwen, GLM, or MiniMax. Uses the configured API key and returns the answer and token usage.',
    inputSchema: {
      model: z.string().min(1).max(256).describe('Model ID from sinogate_list_models, for example qwen3.7-plus.'),
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
    title: 'List models and prices',
    description: 'List currently available SinoGate / 深空渡 models, modalities, thinking support, and public prices. Optionally filter by provider (deepseek, kimi, qwen, glm, minimax) and/or modality (chat, image, video, vision). Prices link to the official pricing page for the configured site.',
    inputSchema: {
      provider: z.string().min(1).max(64).optional().describe('Optional provider filter, for example qwen or deepseek.'),
      modality: z.enum(['chat', 'image', 'video', 'vision']).optional()
        .describe('Optional modality filter. Use image for generate_image, video for submit_video.'),
    },
  },
  async ({ provider, modality }) => {
    try {
      const result = await client.listModels(provider, modality)
      return jsonResult({
        ...result,
        ...(result.pricingAvailable ? {} : {
          pricingNote: `The public price feed could not be loaded. Check current prices at ${client.pricingUrl}.`,
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
    title: 'Compare models',
    description: 'Run the same prompt against 2 to 4 model IDs in parallel. Returns each answer, latency, and token usage; calls are billed to the configured account.',
    inputSchema: {
      prompt: z.string().min(1).max(100_000).describe('Prompt to send unchanged to each model.'),
      models: z.array(z.string().min(1).max(256)).min(2).max(4).describe('Two to four model IDs.'),
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

server.registerTool(
  'sinogate_generate_image',
  {
    title: 'Generate an image',
    description: 'Synchronous text-to-image via SinoGate / 深空渡 (OpenAI-compatible). Returns temporary image URL(s) or base64. Images are not stored — download promptly (~24h). Does not poll or retry on failure.',
    inputSchema: {
      model: z.string().min(1).max(256).describe('Image model ID (modalities includes image), for example qwen-image-3.0.'),
      prompt: z.string().min(1).max(10_000).describe('Image description (Chinese or English).'),
      n: z.number().int().min(1).max(4).optional().describe('Number of images (default 1). Some models only allow 1.'),
      size: z.string().min(3).max(32).optional().describe('Size such as 1024x1024 or 1024*1024.'),
      response_format: z.enum(['url', 'b64_json']).optional().describe('url (default) or b64_json.'),
    },
  },
  async ({ model, prompt, n, size, response_format }) => {
    try {
      const response = await client.generateImage({
        model,
        prompt,
        ...(n === undefined ? {} : { n }),
        ...(size === undefined ? {} : { size }),
        ...(response_format === undefined ? {} : { response_format }),
      })
      return jsonResult({
        model,
        created: response.created ?? null,
        data: response.data ?? [],
        note: 'Temporary URLs typically expire in ~24 hours. Download promptly.',
      })
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_edit_image',
  {
    title: 'Edit an image with reference image(s)',
    description: 'Synchronous image-to-image / reference-image edit via POST /v1/images/edits. Requires at least one reference image (data URL or platform asset HTTPS URL). Classic mask inpainting is not supported. Use models such as wan2.7-image, qwen-image-3.0, or qwen-image-2.1.',
    inputSchema: {
      model: z.string().min(1).max(256).describe('Image model ID that accepts reference images, e.g. qwen-image-3.0 or wan2.7-image.'),
      prompt: z.string().min(1).max(10_000).describe('Edit instruction (Chinese or English).'),
      image: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])
        .describe('Reference image data URL (image/jpeg|png|webp|bmp) or platform asset HTTPS URL; array for multi-ref models.'),
      n: z.number().int().min(1).max(4).optional().describe('Number of images (default 1).'),
      size: z.string().min(3).max(32).optional().describe('Size such as 1024x1024 or 1024*1024.'),
      response_format: z.enum(['url', 'b64_json']).optional().describe('url (default) or b64_json.'),
    },
  },
  async ({ model, prompt, image, n, size, response_format }) => {
    try {
      const response = await client.editImage({
        model,
        prompt,
        image,
        ...(n === undefined ? {} : { n }),
        ...(size === undefined ? {} : { size }),
        ...(response_format === undefined ? {} : { response_format }),
      })
      return jsonResult({
        model,
        created: response.created ?? null,
        data: response.data ?? [],
        note: 'Temporary URLs typically expire in ~24 hours. Download promptly.',
      })
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_submit_video',
  {
    title: 'Submit a video generation job',
    description: 'Start an asynchronous text-to-video or image-to-video job and return immediately with id and status. Does NOT wait for completion and does NOT auto-retry. Poll with sinogate_get_video_status, or pass callback_url for a terminal webhook.',
    inputSchema: {
      model: z.string().min(1).max(256).describe('Video model ID (modalities includes video), for example wan2.6-t2v.'),
      prompt: z.string().min(1).max(10_000).describe('Video description (Chinese or English).'),
      duration: z.number().int().min(2).max(15).optional().describe('Length in seconds (2–15, default 5).'),
      resolution: z.enum(['720P', '1080P']).optional().describe('720P or 1080P (default 1080P).'),
      ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']).optional().describe('Aspect ratio (default 16:9).'),
      callback_url: z.string().url().max(2048).optional()
        .describe('Optional public HTTPS webhook URL for terminal status. localhost/private networks are rejected by the API.'),
      image_url: z.string().url().max(2048).optional()
        .describe('Optional i2v first-frame / reference image (public HTTPS). Required for models whose id contains -i2v.'),
      extra: z.record(z.string(), z.unknown()).optional()
        .describe('Optional provider passthrough (bailian allowlist). Unknown keys are rejected by the API.'),
      idempotency_key: z.string().min(1).max(128).optional()
        .describe('Optional Idempotency-Key header to prevent duplicate charges on replay. Reusing a key with different params returns 422.'),
    },
  },
  async ({ model, prompt, duration, resolution, ratio, callback_url, image_url, extra, idempotency_key }) => {
    try {
      const job = await client.submitVideo({
        model,
        prompt,
        ...(duration === undefined ? {} : { duration }),
        ...(resolution === undefined ? {} : { resolution }),
        ...(ratio === undefined ? {} : { ratio }),
        ...(callback_url === undefined ? {} : { callback_url }),
        ...(image_url === undefined ? {} : { image_url }),
        ...(extra === undefined ? {} : { extra }),
      }, idempotency_key)
      return jsonResult({
        ...job,
        next_step: 'Call sinogate_get_video_status with this id until succeeded/failed/expired/cancelled. Do not auto-resubmit on timeout.',
      })
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_get_video_status',
  {
    title: 'Get video job status',
    description: 'Poll a video job by id. Status: queued → running → succeeded | failed | expired | cancelled. On succeeded, url is a temporary upstream MP4 link. This tool does not wait or auto-retry.',
    inputSchema: {
      id: z.string().min(1).max(128).describe('Video job id returned by sinogate_submit_video (vid_…).'),
    },
  },
  async ({ id }) => {
    try {
      const job = await client.getVideo(id)
      return jsonResult(job)
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_list_videos',
  {
    title: 'List recent video jobs',
    description: 'List this organization’s video jobs from the last 24 hours, paged and optionally filtered by status.',
    inputSchema: {
      status: z.enum(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled']).optional()
        .describe('Optional status filter.'),
      page: z.number().int().min(1).max(1000).optional().describe('Page number (default 1).'),
      page_size: z.number().int().min(1).max(100).optional().describe('Items per page (default 20, max 100).'),
    },
  },
  async ({ status, page, page_size }) => {
    try {
      const result = await client.listVideos({
        ...(status === undefined ? {} : { status }),
        ...(page === undefined ? {} : { page }),
        ...(page_size === undefined ? {} : { page_size }),
      })
      return jsonResult(result)
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_cancel_video',
  {
    title: 'Cancel a queued video job',
    description: 'Cancel an upstream queued (pending) video job and release its credit hold. Returns an error (409) if generation has already started or finished.',
    inputSchema: {
      id: z.string().min(1).max(128).describe('Video job id returned by sinogate_submit_video (vid_…).'),
    },
  },
  async ({ id }) => {
    try {
      const job = await client.cancelVideo(id)
      return jsonResult(job)
    } catch (error) {
      return errorResult(messageOf(error))
    }
  },
)

server.registerTool(
  'sinogate_download_video',
  {
    title: 'Get video download URLs',
    description: 'When the job has succeeded, return the temporary upstream MP4 url and the content proxy URL. Does not stream binary into the agent context (files are large). If not ready, returns current status without waiting.',
    inputSchema: {
      id: z.string().min(1).max(128).describe('Video job id (vid_…).'),
    },
  },
  async ({ id }) => {
    try {
      const job = await client.getVideo(id)
      if (job.status !== 'succeeded' || typeof job.url !== 'string' || !job.url) {
        return jsonResult({
          id: job.id,
          status: job.status,
          ready: false,
          error: job.error ?? null,
          note: 'Video is not ready to download yet. Poll sinogate_get_video_status; do not auto-resubmit.',
        })
      }
      return jsonResult({
        id: job.id,
        status: job.status,
        ready: true,
        url: job.url,
        url_expires_hint: job.url_expires_hint ?? 'Temporary URL; download promptly.',
        content_url: client.videoContentUrl(id),
        note: 'Prefer url for direct download, or content_url with the same Bearer API key. The platform does not store the file.',
      })
    } catch (error) {
      return errorResult(messageOf(error))
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
