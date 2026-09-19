import type {
  JevAnswer,
  JevProviderId,
  JevQuestion,
  JevRequest,
  JevResult,
  JevUsage,
} from '../types'

/**
 * The gateways that serve Jev, one dialect each.
 *
 * Three of them speak TypeSafe's own wire (`{ model, state, questions }` in,
 * `{ model, answers, usage }` out) and differ only in where they are posted;
 * Cloudflare wraps both halves, and Vercel AI Gateway speaks the AI SDK's
 * evaluation-model dialect, where the model rides in a header, a noul is
 * called a `boolean`, and confidence comes back in provider metadata.
 *
 * Nothing here reads the environment: `register.ts` spells every variable
 * name as a literal — the loader refuses a name a module does not spell —
 * and hands the values in as `JevEnv`.
 */

/** Every environment variable the mod reads, by name. */
export type JevEnv = {
  JEV_PROVIDER?: string
  JEV_MODEL?: string
  JEV_ENDPOINT?: string
  JEV_API_KEY?: string
  TYPESAFE_API_KEY?: string
  TYPESAFE_BASE_URL?: string
  OPENROUTER_API_KEY?: string
  AI_GATEWAY_API_KEY?: string
  AI_GATEWAY_BASE_URL?: string
  CLOUDFLARE_API_TOKEN?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_AI_GATEWAY_URL?: string
  LITELLM_API_KEY?: string
  LITELLM_PROXY_BASE_URL?: string
}

/** One HTTP call, ready for `$.http.fetch`. */
export type JevCall = {
  url: string
  headers: Record<string, string>
  body: string
}

/** One gateway: how it is detected, addressed, spoken to and read back. */
export type JevProvider = {
  id: JevProviderId
  /** How the provider is named in an error the user reads. */
  label: string
  /** The model id this provider answers to when the caller names none. */
  model: string
  /** The variables that must be set for the provider to be picked by itself. */
  needs: readonly (keyof JevEnv)[]
  /** Builds the call, or throws naming what is missing. */
  call: (env: JevEnv, request: JevRequest, model: string) => JevCall
  /** Reads a 2xx body into the one result shape, or throws. */
  decode: (body: unknown, model: string) => JevResult
}

/**
 * TypeSafe's own API, and the two gateways that pass its wire through
 * unchanged. `path` is appended to the base URL.
 */
function nativeCall(url: string, key: string, request: JevRequest, model: string): JevCall {
  return {
    url,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      state: request.state,
      questions: request.questions,
    }),
  }
}

/** Reads TypeSafe's own response shape, as three of the providers answer it. */
function nativeDecode(id: JevProviderId, body: unknown, model: string): JevResult {
  if (!isRecord(body) || !isRecord(body.answers)) {
    throw new Error(`$.jev.ask: ${id} answered a body with no answers`)
  }
  return {
    via: id,
    model: typeof body.model === 'string' ? body.model : model,
    ...(typeof body.provider === 'string' ? { provider: body.provider } : {}),
    answers: body.answers as JevResult['answers'],
    usage: usageOf(body.usage),
  }
}

/** The usage block, as far as the provider reported it. Fields may be absent. */
function usageOf(usage: unknown): JevUsage {
  if (!isRecord(usage)) return {}
  const out: { input_tokens?: number; output_tokens?: number; cost?: number } = {}
  if (typeof usage.input_tokens === 'number') out.input_tokens = usage.input_tokens
  if (typeof usage.output_tokens === 'number') out.output_tokens = usage.output_tokens
  // Only OpenRouter prices the call in the response; nothing is computed here,
  // because the price differs per gateway.
  if (typeof usage.cost === 'number') out.cost = usage.cost
  return out
}

/** Joins a base URL and a path without doubling the slash between them. */
function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

/** Throws naming the variable a provider needs and did not get. */
function need(env: JevEnv, name: keyof JevEnv, why: string): string {
  const value = env[name]
  if (value === undefined || value === '') {
    throw new Error(`$.jev.ask: ${name} is unset — ${why}`)
  }
  return value
}

/**
 * The providers in the order auto-detection tries them: TypeSafe's own API
 * first, then the gateways, then the escape hatch.
 */
export const PROVIDERS: readonly JevProvider[] = [
  {
    id: 'typesafe',
    label: 'the TypeSafe API',
    model: 'jev-latest',
    needs: ['TYPESAFE_API_KEY'],
    call: (env, request, model) =>
      nativeCall(
        join(env.TYPESAFE_BASE_URL ?? 'https://api.typesafe.ai', '/v1/systemone'),
        need(env, 'TYPESAFE_API_KEY', 'the TypeSafe API is keyed by it'),
        request,
        model,
      ),
    decode: (body, model) => nativeDecode('typesafe', body, model),
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    // OpenRouter names the model by its catalog slug; `~typesafe/jev-latest`
    // floats, this one is the pinned build.
    model: 'typesafe/jev-1.13',
    needs: ['OPENROUTER_API_KEY'],
    call: (env, request, model) =>
      nativeCall(
        // Note the path: `/api/alpha/decisions`, not `/api/v1/…`, which 404s.
        'https://openrouter.ai/api/alpha/decisions',
        need(env, 'OPENROUTER_API_KEY', 'OpenRouter is keyed by it'),
        request,
        model,
      ),
    decode: (body, model) => nativeDecode('openrouter', body, model),
  },
  {
    id: 'vercel',
    label: 'Vercel AI Gateway',
    model: 'typesafe-ai/jev',
    needs: ['AI_GATEWAY_API_KEY'],
    call: (env, request, model) => ({
      url: join(
        env.AI_GATEWAY_BASE_URL !== undefined && env.AI_GATEWAY_BASE_URL !== ''
          ? env.AI_GATEWAY_BASE_URL
          : 'https://ai-gateway.vercel.sh/v4/ai',
        '/evaluation-model',
      ),
      headers: {
        authorization: `Bearer ${need(env, 'AI_GATEWAY_API_KEY', 'Vercel AI Gateway is keyed by it')}`,
        'content-type': 'application/json',
        // The AI SDK's evaluation-model protocol, as @ai-sdk/gateway sends it.
        'ai-gateway-protocol-version': '0.0.1',
        'ai-gateway-auth-method': 'api-key',
        'ai-evaluation-model-specification-version': '4',
        // The model travels in a header here, never in the body.
        'ai-model-id': model,
      },
      body: JSON.stringify({
        state: request.state,
        questions: toGatewayQuestions(request.questions),
      }),
    }),
    decode: (body, model) => decodeVercel(body, model),
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    model: 'typesafe/jev',
    needs: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
    call: (env, request, model) => ({
      // An AI Gateway URL, when set, stands in for the account endpoint.
      url:
        env.CLOUDFLARE_AI_GATEWAY_URL !== undefined && env.CLOUDFLARE_AI_GATEWAY_URL !== ''
          ? join(env.CLOUDFLARE_AI_GATEWAY_URL, '/ai/run')
          : `https://api.cloudflare.com/client/v4/accounts/${need(
              env,
              'CLOUDFLARE_ACCOUNT_ID',
              'the account is part of the Workers AI URL',
            )}/ai/run`,
      headers: {
        authorization: `Bearer ${need(env, 'CLOUDFLARE_API_TOKEN', 'Workers AI is keyed by it')}`,
        'content-type': 'application/json',
      },
      // Workers AI wraps the request: the questions go under `input`.
      body: JSON.stringify({
        model,
        input: { state: request.state, questions: request.questions },
      }),
    }),
    decode: (body, model) =>
      // …and wraps the response in `{ result, success, errors }`, except where
      // a gateway hands the model's own body straight back.
      nativeDecode(
        'cloudflare',
        isRecord(body) && isRecord(body.result) ? body.result : body,
        model,
      ),
  },
  {
    id: 'litellm',
    label: 'a LiteLLM proxy',
    model: 'jev-latest',
    needs: ['LITELLM_PROXY_BASE_URL', 'LITELLM_API_KEY'],
    call: (env, request, model) =>
      nativeCall(
        join(
          need(env, 'LITELLM_PROXY_BASE_URL', 'the proxy has no address without it'),
          '/typesafe/v1/systemone',
        ),
        need(env, 'LITELLM_API_KEY', 'the proxy takes a virtual key'),
        request,
        model,
      ),
    decode: (body, model) => nativeDecode('litellm', body, model),
  },
  {
    id: 'custom',
    label: 'a TypeSafe-compatible endpoint',
    model: 'jev-latest',
    needs: ['JEV_ENDPOINT', 'JEV_API_KEY'],
    call: (env, request, model) =>
      nativeCall(
        need(env, 'JEV_ENDPOINT', 'a custom endpoint is the whole URL to POST to'),
        need(env, 'JEV_API_KEY', 'the endpoint is keyed by it'),
        request,
        model,
      ),
    decode: (body, model) => nativeDecode('custom', body, model),
  },
]

/**
 * Picks the provider: `JEV_PROVIDER` where it names one, else the first whose
 * variables are all set. Throws naming every accepted variable when none is.
 */
export function providerOf(env: JevEnv): JevProvider {
  const named = env.JEV_PROVIDER?.trim().toLowerCase()
  if (named !== undefined && named !== '') {
    const picked = PROVIDERS.find((provider) => provider.id === named)
    if (!picked) {
      throw new Error(
        `$.jev.ask: JEV_PROVIDER is "${named}", which is none of ` +
          `${PROVIDERS.map((provider) => provider.id).join(', ')}`,
      )
    }
    return picked
  }

  const detected = PROVIDERS.find((provider) =>
    provider.needs.every((name) => env[name] !== undefined && env[name] !== ''),
  )
  if (detected) return detected

  throw new Error(
    '$.jev.ask: no provider is configured. Set one of these in the `env` block of ' +
      '~/.claude/settings.json, or in the shell that starts claude:\n' +
      PROVIDERS.map((provider) => `  ${provider.id}: ${provider.needs.join(' + ')}`).join('\n') +
      '\nJEV_PROVIDER picks one when several are set; JEV_MODEL overrides the model id.',
  )
}

/** The model this request asks for: the caller's, else `JEV_MODEL`, else the provider's. */
export function modelOf(provider: JevProvider, env: JevEnv, request: JevRequest): string {
  const named = request.model ?? env.JEV_MODEL
  return named !== undefined && named !== '' ? named : provider.model
}

/** Vercel AI Gateway calls a noul a `boolean`; everything else is unchanged. */
function toGatewayQuestions(
  questions: Readonly<Record<string, JevQuestion>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [id, question] of Object.entries(questions)) {
    out[id] = question.type === 'noul' ? { ...question, type: 'boolean' } : question
  }
  return out
}

/**
 * Reads the AI SDK evaluation-model response: a `boolean` answer carries
 * `probability` rather than `noul`, usage is camelCase, and TypeSafe's
 * per-question confidence rides in `providerMetadata.typesafe.confidence`.
 * No model id comes back, so the requested one is reported.
 */
function decodeVercel(body: unknown, model: string): JevResult {
  if (!isRecord(body) || !isRecord(body.answers)) {
    throw new Error('$.jev.ask: Vercel AI Gateway answered a body with no answers')
  }

  const metadata = isRecord(body.providerMetadata) ? body.providerMetadata : {}
  const typesafe = isRecord(metadata.typesafe) ? metadata.typesafe : {}
  const confidences = isRecord(typesafe.confidence) ? typesafe.confidence : {}

  const answers: Record<string, JevAnswer> = {}
  for (const [id, raw] of Object.entries(body.answers)) {
    if (!isRecord(raw)) continue
    const confidence = confidences[id]
    const carried = typeof confidence === 'number' ? { confidence } : {}
    if (raw.type === 'boolean') {
      answers[id] = { type: 'noul', noul: Number(raw.probability) }
      continue
    }
    if (raw.type === 'choice') {
      answers[id] = {
        type: 'choice',
        choice: String(raw.choice),
        probabilities: (raw.probabilities ?? {}) as Readonly<Record<string, number>>,
        ...carried,
      }
      continue
    }
    if (raw.type === 'score') {
      answers[id] = {
        type: 'score',
        score: Number(raw.score),
        probabilities: (raw.probabilities ?? {}) as Readonly<Record<string, number>>,
        ...carried,
      }
    }
  }

  const usage = isRecord(body.usage) ? body.usage : {}
  return {
    via: 'vercel',
    model,
    answers,
    usage: {
      ...(typeof usage.inputTokens === 'number' ? { input_tokens: usage.inputTokens } : {}),
      ...(typeof usage.outputTokens === 'number' ? { output_tokens: usage.outputTokens } : {}),
    },
  }
}

/** The endpoint's own message where it sent one, else the body, shortened. */
export function reasonOf(text: string): string {
  const body = parse(text)
  if (isRecord(body)) {
    // `{ error: { message } }` from OpenRouter, `{ error: "…" }` from a gateway.
    if (isRecord(body.error) && typeof body.error.message === 'string') return body.error.message
    if (typeof body.error === 'string') return body.error
    // `{ errors: [{ message }] }` from Cloudflare.
    if (Array.isArray(body.errors)) {
      const messages = body.errors
        .map((one) => (isRecord(one) && typeof one.message === 'string' ? one.message : undefined))
        .filter((one): one is string => one !== undefined)
      if (messages.length > 0) return messages.join('; ')
    }
    // `{ message }` or `{ detail }` from TypeSafe's validation errors.
    if (typeof body.message === 'string') return body.message
    if (typeof body.detail === 'string') return body.detail
    if (body.detail !== undefined) return JSON.stringify(body.detail).slice(0, 200)
  }
  return text.slice(0, 200)
}

/** Parses a body, answering `undefined` rather than throwing on bad JSON. */
export function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
