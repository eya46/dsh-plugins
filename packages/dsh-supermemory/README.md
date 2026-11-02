# @eya46/dsh-supermemory

Persistent memory for DeepSeek Harness sessions, backed by [Supermemory](https://supermemory.ai). The agent receives a user profile on the first turn, relevant memories on later prompts, and can save or forget memories itself. Completed turns are stored automatically.

## Install

```sh
dsh plugin --profile web add @eya46/dsh-supermemory
```

From this monorepo while developing:

```sh
dsh plugin --profile web add "file:./packages/dsh-supermemory"
```

## Sign in

`/supermemory-login` opens the browser, registers a public OAuth client, and stores the refresh token in `~/.supermemory-dsh/` (`SUPERMEMORY_DSH_HOME` overrides the directory). The callback listens on `127.0.0.1:19880`, the same port the other Supermemory coding-agent plugins use, so only one login can run at a time.

`SUPERMEMORY_API_KEY` takes precedence over the saved sign-in. `/supermemory-logout` revokes the refresh token. `/supermemory-status` shows the account, the project container, and whether the API answers.

## What the agent gets

- The first user message of a session injects the profile for this repository.
- Each later substantive prompt searches the repository container and injects up to five fresh matches. The search gives up after three seconds and never blocks the turn.
- Saying "remember", "save this", or "don't forget" (outside code) tells the agent to call `supermemory` with `mode: "add"`.
- Every three completed turns, the conversation is saved. The remainder is saved when the plugin unloads. Text inside `<private>` is redacted and never sent.
- A compaction summary is saved afterwards. The summary request itself cannot be amended: DeepSeek Harness seals that instruction inside the compaction backend.

`/supermemory-index` asks the agent to explore the repository and store its build, architecture, and conventions.

The `supermemory` tool accepts `add`, `search`, `profile`, `list`, `forget`, and `help`. `scope` is `project` (the default) or `user` for a personal preference. Both live in one repository container, distinguished by `sm_scope`, so memories line up with the Claude Code, Codex, and OpenCode plugins.

## Configuration

All fields are optional.

| Field | Default | |
|---|---|---|
| `baseUrl` | `https://api.supermemory.ai` | API origin. |
| `recallMode` | `direct` | `direct` searches every substantive prompt, `advisory` only nudges, `off` disables recall. |
| `similarityThreshold` | `0.55` | Minimum search score. |
| `maxMemories` | `5` | Hits injected per prompt. |
| `maxProfileItems` | `5` | Profile facts injected on the first turn. |
| `injectProfile` | `true` | First-turn profile. |
| `captureEveryNTurns` | `1` | Completed turns saved together. `0` disables capture. |
| `keywordPatterns` | built in | Extra regular expressions that force a save. |
| `saveCompactionSummaries` | `true` | Store the compaction summary as a memory. |
| `recallTimeoutMs` | `3000` | Recall budget. |
| `oauthIssuer` | `${baseUrl}/api/auth` | OAuth issuer override. |
| `oauthResource` | `mcp.` sibling | OAuth resource override, required for a custom backend. |
