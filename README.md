# lance
AI chat toolkit — export, Obsidian vault export, Enter-as-newline, Caveman mode,
Claude usage tracker, settings dashboard.

Supports: ChatGPT, Claude, Gemini, DeepSeek, Brave (search.brave.com/ask)

## Files
- `lance.user.js` — Tampermonkey userscript (install via tampermonkey.net)

That is the whole project. v0.3.0 deleted the localhost relay daemon and its
macOS/systemd autostart units; the export needs no background process.

## Obsidian export

No daemon, no `obsidian://` URI, no clipboard. The Obsidian menu entry saves a
markdown file to a sub-folder of the **browser's download folder**:

```
<browser download folder>/<vault folder>/<platform>/<name>.md
```

A userscript cannot write to an absolute path, so the download folder is what
points at the vault. On this machine that link is:

```bash
ln -s /Users/sol/projects/chats ~/Downloads/chats
```

Browser download folder stays `~/Downloads`; exports land in
`~/Downloads/chats/claude/…` → `/Users/sol/projects/chats/claude/…`.

Vault folder is editable in ⚙ Settings → Obsidian (default `chats`).

### Requirements
- Tampermonkey (uses `GM_download` for the sub-folder path). Without it the
  export still works but drops the file flat in the download folder.
- Browser must not be set to "always ask where to save each file", or the
  sub-folder is ignored.
