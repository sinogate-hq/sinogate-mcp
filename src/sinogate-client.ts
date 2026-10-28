export const PRICING_URL = 'https://sinogate.ai/docs/models-pricing'
export const DEFAULT_BASE_URL = 'https://api.sinogate.ai/v1'

const REQUEST_TIMEOUT_MS = 45_000
const MAX_RESPONSE_BYTES = 5_000_000

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  tool_call_id?: string
}

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
  enable_thinking?: boolean
}

export type ChatResponse = {
  id?: string
  model?: string
  choices?: Array<{
    index?: number
    finish_reason?: string | null
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
    }
  }>
  usage?: Record<string, unknown>
  [key: string]: unknown
}

export type ModelInfo = {
  id: string
  display_name?: string
  owned_by?: string
  description?: string
  modalities?: string[]
  supports_thinking?: boolean
  thinking_required?: boolean
}

type PublicCatalogModel = {
  id: string
  display_name?: string
  description?: string
  description_en?: string
  brand?: string
  modalities?: string[]
  free?: boolean
  supports_thinking?: boolean
  thinking_required?: boolean
  pricing?: {
    currency?: string
    input_per_1m_tokens?: number
    output_per_1m_tokens?: number
    cache_input_per_1m_tokens?: number
    per_image?: number
    billing_expr?: string
  }
  limits?: Record<string, unknown>
}

type OpenAiModelsResponse = { data?: ModelInfo[] }
type PublicCatalogResponse = {
  code?: number
  msg?: string
  data?: { data?: PublicCatalogModel[] } | PublicCatalogModel[]
}

export type ListedModel = {
  id: string
  display_name: string
  provider: string | null
  description: string
  modalities: string[]
  supports_thinking: boolean
  thinking_required: boolean
  pricing: {
    currency: string
    input_per_1m_tokens?: number
    output_per_1m_tokens?: number
    cache_input_per_1m_tokens?: number
    per_image?: number
    billing_expr?: string
  } | null
  pricing_url: string
}

export class SinoGateClient {
  readonly baseUrl: string
  private readonly apiRoot: URL
  private readonly catalogRoot: URL
  private readonly apiKey: string

  constructor(apiKey: string, configuredBaseUrl = DEFAULT_BASE_URL) {
    this.apiKey = apiKey.trim()
    if (!this.apiKey) {
      throw new Error('SINOGATE_API_KEY is required. Create an API key at https://sinogate.ai.')
    }

    const parsed = new URL(configuredBaseUrl.trim() || DEFAULT_BASE_URL)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('SINOGATE_BASE_URL must not contain credentials, a query string, or a fragment.')
    }
    const isLocalHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      throw new Error('SINOGATE_BASE_URL must use HTTPS (HTTP is allowed for localhost development).')
    }

    const path = parsed.pathname.replace(/\/+$/, '')
    if (path !== '' && path !== '/v1') {
      throw new Error('SINOGATE_BASE_URL must be an API origin or end in /v1, for example https://api.sinogate.ai/v1.')
    }

    this.apiRoot = new URL(parsed.origin)
    this.catalogRoot = new URL(parsed.origin)
    // The production API subdomain intentionally exposes only /v1 routes;
    // the public priced catalog is served by the main site.
    if (this.catalogRoot.hostname.toLowerCase() === 'api.sinogate.ai') {
      this.catalogRoot.hostname = 'sinogate.ai'
    }
    this.baseUrl = `${parsed.origin}/v1`
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.requestJson<ChatResponse>(new URL('/v1/chat/completions', this.apiRoot), {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(request),
    })
  }

  async listModels(provider?: string): Promise<{ models: ListedModel[]; pricingAvailable: boolean }> {
    const [modelsResponse, catalogResult] = await Promise.all([
      this.requestJson<OpenAiModelsResponse>(new URL('/v1/models', this.apiRoot), { method: 'GET' }),
      this.requestJson<PublicCatalogResponse>(new URL('/admin/models', this.catalogRoot), {
        method: 'POST',
        body: '{}',
      }).then((value) => ({ value, error: null as string | null }))
        .catch((error: unknown) => ({ value: null, error: messageOf(error) })),
    ])

    const envelopeData = catalogResult.value?.data
    const catalogModels = Array.isArray(envelopeData) ? envelopeData : envelopeData?.data ?? []
    const catalogById = new Map(catalogModels.map((model) => [model.id, model] as const))
    const listed = (modelsResponse.data ?? []).map((model): ListedModel => {
      const catalog = catalogById.get(model.id)
      const price = catalog?.pricing
      return {
        id: model.id,
        display_name: catalog?.display_name || model.display_name || model.id,
        provider: catalog?.brand || null,
        description: catalog?.description_en || catalog?.description || model.description || '',
        modalities: catalog?.modalities || model.modalities || [],
        supports_thinking: catalog?.supports_thinking ?? model.supports_thinking ?? false,
        thinking_required: catalog?.thinking_required ?? model.thinking_required ?? false,
        pricing: price ? {
          currency: price.currency || 'USD',
          ...(price.input_per_1m_tokens == null ? {} : { input_per_1m_tokens: price.input_per_1m_tokens }),
          ...(price.output_per_1m_tokens == null ? {} : { output_per_1m_tokens: price.output_per_1m_tokens }),
          ...(price.cache_input_per_1m_tokens == null ? {} : { cache_input_per_1m_tokens: price.cache_input_per_1m_tokens }),
          ...(price.per_image == null ? {} : { per_image: price.per_image }),
          ...(price.billing_expr ? { billing_expr: price.billing_expr } : {}),
        } : null,
        pricing_url: PRICING_URL,
      }
    })

    const filtered = provider?.trim()
      ? listed.filter((model) => matchesProvider(model, provider.trim()))
      : listed

    return {
      models: filtered,
      pricingAvailable: catalogResult.value !== null && (catalogResult.value.code === undefined || catalogResult.value.code === 200),
    }
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`SinoGate API request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)
      }
      throw new Error(`Could not reach the SinoGate API: ${messageOf(error)}`)
    }

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_RESPONSE_BYTES) {
      throw new Error('SinoGate API response exceeded the 5 MB safety limit.')
    }

    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new Error('SinoGate API response exceeded the 5 MB safety limit.')
    }

    let body: unknown
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      body = { message: text.slice(0, 500) }
    }

    if (!response.ok) {
      const apiMessage = getApiErrorMessage(body).replaceAll(this.apiKey, '[redacted]')
      throw new Error(`SinoGate API returned HTTP ${response.status}${apiMessage ? `: ${apiMessage}` : '.'}`)
    }
    return body as T
  }
}

function matchesProvider(model: ListedModel, requested: string): boolean {
  const needle = requested.toLowerCase()
  const provider = model.provider?.toLowerCase() ?? ''
  const id = model.id.toLowerCase()
  const aliases: Record<string, string[]> = {
    kimi: ['moonshot'],
    moonshot: ['kimi'],
    glm: ['zhipu', 'chatglm'],
    zhipu: ['glm', 'chatglm'],
  }
  const terms = [needle, ...(aliases[needle] ?? [])]
  return terms.some((term) => provider.includes(term) || id.includes(term))
}

function getApiErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string') return error.slice(0, 500)
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message
    if (typeof message === 'string') return message.slice(0, 500)
  }
  return typeof record.message === 'string' ? record.message.slice(0, 500) : ''
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
