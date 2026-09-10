# Bombot — notes for Claude Code

- Monorepo with npm workspaces: `apps/api` (Fastify, TS, ESM), `apps/web` (Next.js 15), `packages/shared` (types only).
- LLM calls go through `apps/api/src/llm/`. `AnthropicProvider` is the only place that touches the SDK; `MockProvider` powers tests. Keep that boundary.
- Main model `claude-opus-5`, safety classifier `claude-haiku-4-5`. Do not add `budget_tokens`, `temperature`, or prefills: the current API rejects them.
- Prompt-cache order is tools -> system (cached) -> messages. Never put timestamps or IDs in the system prompt.
- Tests: `npm test` (no network, PGlite in memory). Typecheck: `npm run typecheck`. Run both before pushing.
- The product spec lives in `docs/bombot-spec.html`; requirement IDs (CHAT-01, SRCH-02, ...) are referenced in commits.
