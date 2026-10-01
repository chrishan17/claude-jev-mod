# jev — typed decisions as a noun in Claude Code

A Claude Code **mod** (a plugin whose behaviour is a hooks module) that adds
`$.jev` to the engine interface. Any plugin seated above it can ask
[Jev](https://typesafe.ai) — TypeSafe's System One model — a map of Choice,
Score and Noul questions over one state, and read calibrated probabilities back:

```ts
const { answers } = await $.jev.ask({
  state: { command: e.command },
  questions: {
    destroys_work: {
      type: 'noul',
      instructions: 'The command deletes files that could not be reproduced.',
      criteria: { true: 'Removes source or data.', false: 'Removes build output.' },
    },
  },
})
if (answers.destroys_work.type === 'noul' && answers.destroys_work.noul > 0.9) {
  return { deny: 'this looks destructive' }
}
```

Jev returns only values from the answer space you declare — never generated text —
so the decision is typed, cheap (input-priced, free output) and fast enough to sit
in a hook.

Bring whichever key you already have: the mod speaks **six providers** and picks
one from your environment.

---

## Install

### 1. Check your Claude Code version

Mods need **Claude Code v2.1.287 or later** and are on by default. Check with
`claude --version`. If you set `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` during early
access, remove it — v2.1.287+ ignores it.

### 2. Add this marketplace and install the plugin

In a Claude Code session:

```
/plugin marketplace add chrishan17/claude-jev-mod
/plugin install jev@jev-mod
```

(Or from a shell: `claude plugin marketplace add chrishan17/claude-jev-mod` then
`claude plugin install jev@jev-mod`.)

### 3. Give it a key

Add **one** provider's variables to the `env` block of `~/.claude/settings.json`
(create the file or block if absent). The mod reads the host
process environment — Claude Code does **not** read a `.env` file — so this block,
or an `export` in the shell that starts `claude`, is how a key arrives.

```json
{
  "env": {
    "TYPESAFE_API_KEY": "ts-…"
  }
}
```

Restart Claude Code. That is the whole setup — `$.jev` is now on `$` for every
plugin in the session.

---

## Providers

| `JEV_PROVIDER` | Variables to set | Endpoint | Default model |
| --- | --- | --- | --- |
| `typesafe` | `TYPESAFE_API_KEY` (+ optional `TYPESAFE_BASE_URL`) | `POST {base}/v1/systemone` | `jev-latest` |
| `openrouter` | `OPENROUTER_API_KEY` | `POST https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` |
| `vercel` | `AI_GATEWAY_API_KEY` (+ optional `AI_GATEWAY_BASE_URL`) | `POST {base}/evaluation-model` | `typesafe-ai/jev` |
| `cloudflare` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (+ optional `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_AI_GATEWAY_URL`) | `POST …/accounts/{id}/ai/run` | `typesafe/jev` |
| `litellm` | `LITELLM_PROXY_BASE_URL` + `LITELLM_API_KEY` | `POST {base}/typesafe/v1/systemone` | `jev-latest` |
| `custom` | `JEV_ENDPOINT` + `JEV_API_KEY` | the URL you give, TypeSafe's own body | `jev-latest` |

Cloudflare's own AI Gateway is that same account endpoint plus a
`cf-aig-gateway-id` header, which `CLOUDFLARE_AI_GATEWAY_ID` sets;
`CLOUDFLARE_AI_GATEWAY_URL` replaces the URL entirely, for a proxy of your own
that accepts the Workers AI REST body.

`custom` is the escape hatch for anything else speaking the System One wire: a
self-hosted proxy, new-api, a gateway not listed here.

**Which one is used.** `JEV_PROVIDER` picks by name. Unset, the first row above
whose variables are all set wins — so one key is enough, and the order only
matters when several are configured.

**Models are not portable.** `jev-latest` on the TypeSafe API and a LiteLLM proxy,
`typesafe/jev-1.13` on OpenRouter, `typesafe/jev` on Cloudflare,
`typesafe-ai/jev` on Vercel AI Gateway. `JEV_MODEL` overrides the default for
every call; `ask({ model })` overrides both.

**Setting nothing** is a clear failure, not a silent one: the first `ask` rejects
with every accepted variable named.

### Verification status

`openrouter` is exercised against the live endpoint. The other five are exercised
end to end against a local server speaking each dialect — which proves the request
this mod builds and the response it reads, **not** that the provider accepts it.
`vercel` follows `@ai-sdk/gateway@4.0.85`'s evaluation-model protocol (noul travels
as the gateway's `boolean` kind; confidence returns in
`providerMetadata.typesafe.confidence`). Treat a first call through an unverified
provider as part of your setup, and please open an issue with what you see.

---

## Using the noun

```ts
import type { On } from 'claude-code'

export function register(on: On) {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const { answers, via, model, usage } = await $.jev.ask({
      state: { command: e.command, cwd: await $.session.cwd() },
      questions: {
        risk: {
          type: 'score',
          instructions: 'How hard would this command be to undo?',
          criteria: ['Trivially reversible', 'Recoverable with effort', 'Irreversible'],
        },
      },
    })
    const risk = answers.risk
    if (risk?.type === 'score' && risk.score > 1.5) return { deny: 'too hard to undo' }
    return next(e)
  })
}
```

Three primitives, picked by what the answer *means*:

| Need | Type | Answer |
| --- | --- | --- |
| One of a defined set | `choice` | `choice` + `probabilities` (+ `confidence`) |
| Whether a condition holds | `noul` | `noul`, the probability of yes — **no confidence field** |
| Degree along an ordered rubric | `score` | `score` + `probabilities` + `legend` (+ `confidence`) |

Notes that bite:

- **One call is one request.** Every question is answered in parallel and cannot
  see the others' answers, so batch the independent ones instead of calling twice.
- **A noul near 0.5 means torn**, not "medium intensity".
- **`confidence` and every `usage` field are optional** on the contract, because
  the providers do not all report them. A missing confidence means *not confident
  enough to act* — never treat it as zero.
- **Question ids are not sent to the model.** Each question must carry its full
  meaning in `instructions` and `criteria`.
- **Hook input is untrusted** (file contents, tool results, user text). Jev does
  not treat state as hostile by default; write explicit criteria and test
  injection cases.
- `ask` **rejects** rather than returning a partial: a missing variable, a non-200,
  an unparseable body, or an unanswered question each throw with the reason named.
  Decide in your hook what failure means — failing open is usually right for a
  guard.

The full contract, with doc comments, is [`types/index.d.ts`](types/index.d.ts).
A plugin that depends on this one gets those types for free: `/plugin-types` in a
session copies each enabled plugin's contract into `.claude/types/`.

---

## Development

```bash
git clone https://github.com/chrishan17/claude-jev-mod
cd claude-jev-mod

# load it from disk for one session (hot-reloads on save)
claude --plugin-dir .

# what the engine sees: the hooks, the $ calls, the env names
claude plugin validate .

# typecheck (needs .claude/types, which /plugin-types writes in-session)
npx -y -p typescript@5 tsc -p tsconfig.json
```

`claude plugin validate` is the fast check and not optional: the loader refuses a
hook whose `$` it cannot follow, and a refused hook is *silently absent*. Every
environment variable is spelled as a string literal at its own call site in
`hooks/register.ts` for the same reason — a name the module does not spell is
refused, and a noun of `$` may not be passed as a value at all.

---

## License

MIT © Chris Han
