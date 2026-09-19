import type { EngineInterface, On } from 'claude-code'

import { jevOf } from './jev-of'
import type { JevEnv } from './providers'

/**
 * Assembles what the reads answered. Every name is spelled as a **string
 * literal** at its own `env.get` call site below: the loader reads what a
 * module reads off its source, and a name it does not spell is refused, so
 * there is no table-driven read and no way to shorten this.
 * `claude plugin validate` lists every name it found.
 */
function envOf(values: readonly (string | undefined)[]): JevEnv {
  const [
    JEV_PROVIDER,
    JEV_MODEL,
    JEV_ENDPOINT,
    JEV_API_KEY,
    TYPESAFE_API_KEY,
    TYPESAFE_BASE_URL,
    OPENROUTER_API_KEY,
    AI_GATEWAY_API_KEY,
    AI_GATEWAY_BASE_URL,
    CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_AI_GATEWAY_URL,
    CLOUDFLARE_AI_GATEWAY_ID,
    LITELLM_API_KEY,
    LITELLM_PROXY_BASE_URL,
  ] = values

  return {
    JEV_PROVIDER,
    JEV_MODEL,
    JEV_ENDPOINT,
    JEV_API_KEY,
    TYPESAFE_API_KEY,
    TYPESAFE_BASE_URL,
    OPENROUTER_API_KEY,
    AI_GATEWAY_API_KEY,
    AI_GATEWAY_BASE_URL,
    CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_AI_GATEWAY_URL,
    CLOUDFLARE_AI_GATEWAY_ID,
    LITELLM_API_KEY,
    LITELLM_PROXY_BASE_URL,
  }
}

/**
 * Registers the mod's one hook: its engine.create step adds `$.jev` over the
 * nouns beneath, the plugin's own `$` as core built.
 *
 * `ask` runs after the fold, reaching `$.env` and `$.http` through the nouns
 * beneath; the environment is read on every call, so a key exported after the
 * session started is picked up without a reload.
 *
 * @param on the engine's registrar
 */
export function register(on: On) {
  on('engine.create', async ($, e, next) => {
    const beneath = await next(e)

    const jev: EngineInterface['jev'] = jevOf({
      env: async () =>
        envOf(
          await Promise.all([
            beneath.env.get('JEV_PROVIDER'),
            beneath.env.get('JEV_MODEL'),
            beneath.env.get('JEV_ENDPOINT'),
            beneath.env.get('JEV_API_KEY'),
            beneath.env.get('TYPESAFE_API_KEY'),
            beneath.env.get('TYPESAFE_BASE_URL'),
            beneath.env.get('OPENROUTER_API_KEY'),
            beneath.env.get('AI_GATEWAY_API_KEY'),
            beneath.env.get('AI_GATEWAY_BASE_URL'),
            beneath.env.get('CLOUDFLARE_API_TOKEN'),
            beneath.env.get('CLOUDFLARE_ACCOUNT_ID'),
            beneath.env.get('CLOUDFLARE_AI_GATEWAY_URL'),
            beneath.env.get('CLOUDFLARE_AI_GATEWAY_ID'),
            beneath.env.get('LITELLM_API_KEY'),
            beneath.env.get('LITELLM_PROXY_BASE_URL'),
          ]),
        ),
      fetch: async (url, init) => {
        // No `auth` handle: that one is the session's own credential and rides
        // to first-party hosts only. This request carries its own bearer.
        const { ok, status, text } = await beneath.http.fetch(url, init)
        return { ok, status, text }
      },
    })

    return { ...beneath, jev }
  })
}
