/**
 * The `$.jev` noun as every caller sees it: the one contract for the noun,
 * its types exported here and the noun declared on `EngineInterface`.
 *
 * The jev mod adds the noun in the `engine.create` fold and checks its return
 * against `EngineInterface['jev']`; its hooks import these types from this
 * folder, a mod that calls the noun and a test that answers it read them by
 * including it in their tsconfig. Nothing here is imported, so it stands on
 * its own.
 */

/**
 * Typed decisions from a System One model, asked one state at a time.
 *
 * The jev mod adds the noun in the `engine.create` fold, so a session where
 * the mod is not seated finds no `$.jev` and its call throws.
 */
export type Jev = {
  /**
   * Asks every question over one state and resolves once the model answered
   * them all; they run in parallel and cannot see one another's answers.
   *
   * Rejects when no provider is configured, when the endpoint refuses the
   * request, or when the body is not the shape below. One input, as every op
   * on `$` takes.
   *
   * @param request the state to judge, the questions to ask of it, and the
   *   model to ask (the provider's own default when unset)
   * @returns the resolved build, an answer per question id, and the usage
   * @example
   * const { answers } = await $.jev.ask({
   *   state: { command: "rm -rf /tmp/build" },
   *   questions: {
   *     destructive: {
   *       type: "noul",
   *       instructions: "The command deletes files that are not reproducible.",
   *       criteria: { true: "Removes source, history or data.", false: "Removes build output, caches or temporary files." },
   *     },
   *   },
   * })
   * if (answers.destructive.noul > 0.9) return { deny: "destructive" }
   */
  ask: (request: JevRequest) => Promise<JevResult>
}

/** The gateways that serve Jev, as `JEV_PROVIDER` names them. */
export type JevProviderId =
  | 'typesafe'
  | 'openrouter'
  | 'vercel'
  | 'cloudflare'
  | 'litellm'
  | 'custom'

/**
 * One request: the state, the questions asked of it, and optionally the model.
 */
export type JevRequest = {
  /** What is being judged; named fields where the context has several parts. */
  state: JevState
  /** The questions by id. Ids are for code and are never sent to the model. */
  questions: Readonly<Record<string, JevQuestion>>
  /**
   * The model to ask. Ids differ per gateway (`jev-latest` on the TypeSafe
   * API and a LiteLLM proxy, `typesafe/jev-1.13` on OpenRouter,
   * `typesafe/jev` on Cloudflare, `typesafe-ai/jev` on Vercel AI Gateway),
   * so leave it unset unless the provider is known. `JEV_MODEL` sets it for
   * every call; this field wins over both.
   */
  model?: string
}

/** The state a question is asked over: text, a record, or a list of either. */
export type JevState = string | Readonly<Record<string, unknown>> | readonly unknown[]

/** One question: what to judge, and what the answers mean. */
export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion

/**
 * Whether a condition holds, answered as the probability of yes.
 *
 * There is no separate confidence: the probability is the answer. A value
 * near 0.5 means yes and no are similarly likely, not medium intensity.
 */
export type JevNoulQuestion = {
  type: 'noul'
  /** The condition, stated as an observable fact rather than a goal. */
  instructions: JevInstructions
  /** What each side means; boundary cases belong here. */
  criteria?: { true: string; false: string }
}

/** One of a defined set of options. */
export type JevChoiceQuestion = {
  type: 'choice'
  instructions: JevInstructions
  /**
   * The options by name, each with the guidance that picks it. Include a
   * no-match option when nothing may fit: the model cannot choose one that
   * is not here.
   */
  criteria: Readonly<Record<string, string>>
}

/** A position along an ordered rubric. */
export type JevScoreQuestion = {
  type: 'score'
  instructions: JevInstructions
  /**
   * The levels in ascending order, two to ten of them, each describing a
   * concrete situation that stands on its own.
   */
  criteria: readonly string[]
}

/**
 * A question's instructions: a sentence, or a structure where definitions,
 * contrasts, exclusions or examples make the judgment clearer.
 */
export type JevInstructions = string | Readonly<Record<string, unknown>> | readonly unknown[]

/** What one request answered. */
export type JevResult = {
  /** Which gateway served the call. */
  via: JevProviderId
  /**
   * The build that answered, dated (`jev-1.13-20260917`) where the gateway
   * reports one; Vercel AI Gateway reports none, so the requested id stands.
   */
  model: string
  /** The provider that served it. */
  provider?: string
  /** One answer per question id, keyed as the questions were. */
  answers: Readonly<Record<string, JevAnswer>>
  /**
   * What the request cost, as far as the gateway reported it: every field is
   * optional, because they do not all report the same ones.
   */
  usage: JevUsage
}

/** One question's answer, narrowed by `type`. */
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer

/** The probability that the condition holds, 0 to 1. No confidence field. */
export type JevNoulAnswer = {
  type: 'noul'
  noul: number
}

/** The option picked, with the distribution it was picked from. */
export type JevChoiceAnswer = {
  type: 'choice'
  choice: string
  /** How the probability fell across the options, by name. */
  probabilities: Readonly<Record<string, number>>
  /**
   * How concentrated that distribution is, 0 to 1; not a claim of truth.
   * Absent where the gateway does not report it — treat a missing value as
   * "not confident enough to act", never as zero.
   */
  confidence?: number
}

/** The position on the rubric, with the distribution across its levels. */
export type JevScoreAnswer = {
  type: 'score'
  score: number
  probabilities: Readonly<Record<string, number>>
  /** As on a choice: absent where the gateway does not report it. */
  confidence?: number
  /** The levels as the model read them, by index. */
  legend?: Readonly<Record<string, string>>
}

/**
 * What a request cost, as far as the gateway reported it.
 *
 * Every field is optional: only OpenRouter prices the call in the response,
 * and nothing is computed here, because the price differs per gateway.
 */
export type JevUsage = {
  input_tokens?: number
  output_tokens?: number
  /** In US dollars. Input only: output tokens bill at zero. */
  cost?: number
}

declare module 'claude-code' {
  interface EngineInterface {
    /**
     * Typed decisions from a System One model; present only where the jev mod
     * is seated, absent everywhere else.
     */
    jev: Jev
  }
}
