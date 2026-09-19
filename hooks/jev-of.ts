import type { Jev, JevRequest, JevResult } from '../types'

import { modelOf, parse, providerOf, reasonOf, type JevEnv } from './providers'

/** What the noun is built over: the nouns beneath, narrowed to what it uses. */
export type JevDeps = {
  /**
   * Reads every variable the mod knows, each spelled as a literal at its own
   * call site in `register.ts` — a name the module does not spell is refused.
   */
  env: () => Promise<JevEnv>
  /** Fetches through the host, never the plugin's own network. */
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{ ok: boolean; status: number; text: string }>
}

/**
 * Builds the `$.jev` noun over the nouns beneath.
 *
 * One call is one request: every question is answered in parallel, so ask the
 * independent ones together rather than in sequence. Which gateway serves it
 * is read from the environment on every call, so a key set mid-session takes.
 *
 * @param deps the environment and the fetch the noun runs on
 * @returns the noun, checked against `EngineInterface['jev']` by the caller
 */
export function jevOf(deps: JevDeps): Jev {
  return {
    async ask(request: JevRequest): Promise<JevResult> {
      const ids = Object.keys(request.questions)
      if (ids.length === 0) throw new Error('$.jev.ask: no questions asked')

      const env = await deps.env()
      const provider = providerOf(env)
      const model = modelOf(provider, env, request)
      const call = provider.call(env, request, model)

      const response = await deps.fetch(call.url, {
        method: 'POST',
        headers: call.headers,
        body: call.body,
      })

      if (!response.ok) {
        throw new Error(
          `$.jev.ask: ${provider.label} answered ${response.status}: ${reasonOf(response.text)}`,
        )
      }

      const result = provider.decode(parse(response.text), model)

      // A question the endpoint skipped would surface later as a read of
      // undefined, in the hook that asked rather than here. Name it now.
      const missing = ids.filter((id) => !(id in result.answers))
      if (missing.length > 0) {
        throw new Error(`$.jev.ask: ${provider.label} left ${missing.join(', ')} unanswered`)
      }

      return result
    },
  }
}
