import { expect, test } from 'claude-code/testing'

import { jevOf, type JevDeps } from '../hooks/jev-of'
import type { JevEnv } from '../hooks/providers'

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> }

/** A noun over a fixed environment and a fetch that records the request and answers `reply`. */
function nounOver(env: JevEnv, reply: { ok?: boolean; status?: number; body: unknown }) {
  const seen: Seen[] = []
  const deps: JevDeps = {
    env: async () => env,
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        text: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body),
      }
    },
  }
  return { jev: jevOf(deps), seen }
}

/** What a rejected promise said; fails the test when it resolved instead. */
async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return '<resolved>'
}

const ASK = {
  state: { command: 'rm -rf build' },
  questions: {
    destroys_work: {
      type: 'noul',
      instructions: 'The command deletes files that cannot be reproduced.',
      criteria: { true: 'Removes source or data.', false: 'Removes build output.' },
    },
  },
} as const

/** The answer TypeSafe's own wire gives for ASK. */
const NATIVE = {
  model: 'jev-1.13-20260917',
  answers: { destroys_work: { type: 'noul', noul: 0.04 } },
  usage: { input_tokens: 100, output_tokens: 5, cost: 0.000004 },
}

test('typesafe is tried first when several providers are configured', async () => {
  const { jev, seen } = nounOver(
    { TYPESAFE_API_KEY: 'ts', OPENROUTER_API_KEY: 'or' },
    { body: NATIVE },
  )
  const result = await jev.ask(ASK)
  expect(seen[0]?.url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(seen[0]?.headers.authorization).toBe('Bearer ts')
  expect(result.via).toBe('typesafe')
})

test('JEV_PROVIDER overrides detection', async () => {
  const { jev, seen } = nounOver(
    { JEV_PROVIDER: 'openrouter', TYPESAFE_API_KEY: 'ts', OPENROUTER_API_KEY: 'or' },
    { body: NATIVE },
  )
  const result = await jev.ask(ASK)
  expect(seen[0]?.url).toBe('https://openrouter.ai/api/alpha/decisions')
  expect(seen[0]?.headers.authorization).toBe('Bearer or')
  expect(seen[0]?.body.model).toBe('typesafe/jev-1.13')
  expect(result.via).toBe('openrouter')
  expect(result.model).toBe('jev-1.13-20260917')
  expect(result.usage.cost).toBe(0.000004)
})

test('an unknown JEV_PROVIDER names the ones that exist', async () => {
  const { jev } = nounOver({ JEV_PROVIDER: 'nope' }, { body: NATIVE })
  expect(await messageOf(jev.ask(ASK))).toContain('typesafe, openrouter, vercel, cloudflare, litellm, custom')
})

test('with nothing configured it names every variable it would accept', async () => {
  const { jev, seen } = nounOver({}, { body: NATIVE })
  expect(await messageOf(jev.ask(ASK))).toContain('OPENROUTER_API_KEY')
  expect(seen.length).toBe(0)
})

test('a base URL redirects typesafe and a trailing slash does not double', async () => {
  const { jev, seen } = nounOver(
    { TYPESAFE_API_KEY: 'ts', TYPESAFE_BASE_URL: 'http://localhost:9000/' },
    { body: NATIVE },
  )
  await jev.ask(ASK)
  expect(seen[0]?.url).toBe('http://localhost:9000/v1/systemone')
})

test('litellm and custom speak the native wire to the host the user gave', async () => {
  const lite = nounOver(
    { LITELLM_PROXY_BASE_URL: 'https://proxy.example/', LITELLM_API_KEY: 'sk-1' },
    { body: NATIVE },
  )
  expect((await lite.jev.ask(ASK)).via).toBe('litellm')
  expect(lite.seen[0]?.url).toBe('https://proxy.example/typesafe/v1/systemone')

  const custom = nounOver(
    { JEV_ENDPOINT: 'https://gw.example/decide', JEV_API_KEY: 'k' },
    { body: NATIVE },
  )
  expect((await custom.jev.ask(ASK)).via).toBe('custom')
  expect(custom.seen[0]?.url).toBe('https://gw.example/decide')
})

test('vercel sends a noul as boolean and reads probability and confidence back', async () => {
  const { jev, seen } = nounOver(
    { AI_GATEWAY_API_KEY: 'gw' },
    {
      body: {
        answers: {
          destroys_work: { type: 'boolean', probability: 0.9 },
          kind: { type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 } },
        },
        providerMetadata: { typesafe: { confidence: { kind: 0.7 } } },
        usage: { inputTokens: 12, outputTokens: 3 },
      },
    },
  )
  const result = await jev.ask({
    ...ASK,
    questions: {
      ...ASK.questions,
      kind: { type: 'choice', instructions: 'Pick.', criteria: { a: 'A', b: 'B' } },
    },
  })
  const sent = seen[0]
  expect(sent?.url).toBe('https://ai-gateway.vercel.sh/v4/ai/evaluation-model')
  expect(sent?.headers['ai-model-id']).toBe('typesafe-ai/jev')
  expect((sent?.body.questions as Record<string, { type: string }>).destroys_work?.type).toBe('boolean')
  expect(result.answers.destroys_work).toEqual({ type: 'noul', noul: 0.9 })
  expect(result.answers.kind).toMatchObject({ type: 'choice', choice: 'a', confidence: 0.7 })
  expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 3 })
})

test('cloudflare wraps the request under input and unwraps result', async () => {
  const { jev, seen } = nounOver(
    {
      CLOUDFLARE_API_TOKEN: 'cf',
      CLOUDFLARE_ACCOUNT_ID: 'acct',
      CLOUDFLARE_AI_GATEWAY_ID: 'gw-1',
    },
    { body: { success: true, result: NATIVE } },
  )
  const result = await jev.ask(ASK)
  expect(seen[0]?.url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/ai/run')
  expect(seen[0]?.headers['cf-aig-gateway-id']).toBe('gw-1')
  expect(Object.keys(seen[0]?.body.input as object).sort().join()).toBe('questions,state')
  expect(result.via).toBe('cloudflare')
  expect(result.answers.destroys_work).toEqual({ type: 'noul', noul: 0.04 })
})

test('a request model beats JEV_MODEL, which beats the provider default', async () => {
  const env = { OPENROUTER_API_KEY: 'or', JEV_MODEL: 'typesafe/jev-pinned' }
  const a = nounOver(env, { body: NATIVE })
  await a.jev.ask(ASK)
  expect(a.seen[0]?.body.model).toBe('typesafe/jev-pinned')

  const b = nounOver(env, { body: NATIVE })
  await b.jev.ask({ ...ASK, model: 'typesafe/jev-explicit' })
  expect(b.seen[0]?.body.model).toBe('typesafe/jev-explicit')
})

test('a non-200 rejects with the provider and the reason it gave', async () => {
  const { jev } = nounOver(
    { OPENROUTER_API_KEY: 'or' },
    { ok: false, status: 402, body: { error: { message: 'Insufficient credits' } } },
  )
  expect(await messageOf(jev.ask(ASK))).toContain('OpenRouter answered 402: Insufficient credits')
})

test('a question the endpoint skipped is named, not left to read as undefined', async () => {
  const { jev } = nounOver(
    { OPENROUTER_API_KEY: 'or' },
    { body: { answers: { something_else: { type: 'noul', noul: 0.5 } } } },
  )
  expect(await messageOf(jev.ask(ASK))).toContain('destroys_work unanswered')
})

test('asking nothing is refused before any request is made', async () => {
  const { jev, seen } = nounOver({ OPENROUTER_API_KEY: 'or' }, { body: NATIVE })
  expect(await messageOf(jev.ask({ state: {}, questions: {} }))).toContain('no questions asked')
  expect(seen.length).toBe(0)
})
