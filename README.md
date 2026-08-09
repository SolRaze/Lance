# lance
Chat exporter with prompt-mode toggles — Markdown/JSON/CSV/TXT/HTML export,
Enter-as-newline, Caveman and Ponytail prompt modes, first-prompt injection,
Claude usage tracker, settings dashboard.

Supports: Claude, DeepSeek, Brave (search.brave.com/ask)

## Files
- `lance.user.js` — the userscript (install via tampermonkey.net)
- `skills/caveman/SKILL.md`, `skills/ponytail/SKILL.md` — source of truth for the
  prompt-mode text embedded in the script
- `skills/injection/` — your own first-prompt payloads, one file per vendor

## Export

Five formats, all plain browser downloads. Markdown carries YAML frontmatter
(title, date, source, url, turns) and one `## User` / `## Assistant` block per
turn, so it drops straight into a vault without post-processing.

Where the file lands is the browser's business — it reuses the last folder you
picked. Set that once, or turn on "always ask where to save each file" if you
sort per download. No daemon, no vault path in the script.

## Prompt modes

Both prepend to your message when you send with the configured shortcut, and
stack: injection first, then ponytail, then caveman.

- **Caveman** — compresses prose. Levels: lite / full / ultra.
- **Ponytail** — governs code answers only (YAGNI ladder). Levels: lite / full / ultra.
- **First-prompt injection** — fires once per tab, on the first message you send.
  Per-site toggle, re-armable from the pill menu.

Injection text is empty by default. Paste what you want into
`INJECTION_PROMPTS` in the script, keyed by platform id (`claude`, `deepseek`);
a site with no entry never shows the toggle.

Caveman and Ponytail text is embedded in the script but its source of truth is
`skills/`. Edit the skill, then update the matching const — they do not sync
themselves.

## UI

Two draggable pills, collapsed to 42px circles and expanding on open. The
export pill carries the lance mark; the prompt-mode pill shows the active
level's initial and lights up whenever any mode is armed.
