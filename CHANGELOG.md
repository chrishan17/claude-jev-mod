# Changelog

## 0.3.3
- Manifest: `displayName`, `license`, `repository`, author URL; description mentions plugin options.
- `tests/jev.test.ts`: 12 offline tests over every provider dialect (`claude plugin test .`).

## 0.3.2
- `userConfig.provider` no longer declares `options` (the plugin directory's validator does not accept them yet); valid values are in its description.

## 0.3.1
- README names the real entry point for the options dialog.

## 0.3.0
- `userConfig`: every setting is a plugin option, API keys `sensitive`; an option wins over the same-named environment variable, which stays as the fallback.
- Icon; README sections on credentials, data sent and hosts contacted.

## 0.2.2
- Requires Claude Code 2.1.287+ (mods are released; `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` is ignored). README is English only.

## 0.2.1
- Cloudflare AI Gateway is a header (`cf-aig-gateway-id`), not a path.

## 0.2.0
- `$.jev` over six providers: TypeSafe, OpenRouter, Vercel AI Gateway, Cloudflare Workers AI, LiteLLM, custom.
