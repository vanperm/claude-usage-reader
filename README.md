# Claude Usage Reader

A local dashboard for how many tokens you've used with Claude and what that
costs at API rates. No dependencies, no network calls, no API key required
for the primary view.

## Run it

```
node server.js
```

Then open http://localhost:4317.

## Tabs

- **Claude Code** — exact token counts and cost, parsed directly from your
  local `~/.claude/projects/**/*.jsonl` session logs. Breakdowns by day,
  model, project, and session.
- **Web Chat (estimate)** — import a claude.ai "Export data" download
  (`conversations.json`). Tokens are estimated as `chars / 4` since there's
  no usage API for web chat and no offline tokenizer — always labeled as an
  estimate, and it will undercount real spend (no system prompts, tool
  calls, thinking tokens, or cache accounting).
- **Pricing** — the `$`/MTok table backing both tabs' cost math, editable
  in the UI and persisted to `pricing.json`. Any model found in the logs
  that isn't priced shows as unpriced (`*`) rather than guessing a rate.

## Notes

- Cache tokens are priced using the standard Anthropic multipliers on a
  model's input rate (read ×0.1, 5m write ×1.25, 1h write ×2), overridable
  per-model in `pricing.json`.
- `data/webchat-import.json` (your imported web-chat estimate) is
  gitignored — it's local personal usage data, not project source.
