# OpenClaude

A Claude-style desktop assistant that works with any OpenAI-compatible model, including free ones. Pick a provider, paste a key, and the model can read and edit files in your workspace, run commands, search the web, and build live HTML artifacts, with your approval for anything that changes your machine.

## Features
- **Any provider:** OpenRouter, Groq, Google AI Studio (Gemini), NVIDIA NIM, Cerebras, Mistral, DeepSeek, Together AI, OpenAI, plus local Ollama and LM Studio. Add any other OpenAI-compatible endpoint as a custom provider.
- **Multiple keys per provider:** key 1 is used first; on an auth or rate-limit error the next key is tried.
- **Agent tools:** `list_files`, `read_file`, `grep`, `write_file`, `edit_file`, `bash`, `web_fetch`, `web_search`, `create_artifact`. Up to 20 tool steps per reply.
- **Permission modes:** *Ask before edits*, *Auto-edit* (still asks before shell commands), *Plan* (read-only).
  - Writes to `.claude/**` (hooks, skills), `.git/**`, `.husky/**` and `.vscode/**`, and commands mentioning those folders or the app data folder, always ask, in every mode. The app data folder (config, keys, schedules) is outside the file tools' reach.
  - Allow-listed bash prefixes only cover a single plain command. A prefix that runs workspace code (`npm run`, `node`, `python`) is equivalent to full bash, since the agent can edit that code; it can also reach `.claude/**` indirectly (for example `git checkout` of a branch that contains it).
- **Artifacts:** HTML pages open in a resizable side panel with Preview, Code, Copy and Download. They run in a sandboxed frame.
- **Desktop app:** Electron wrapper with a native folder picker. The server only listens on `127.0.0.1`.

## Quick start (desktop)
Download the installer from Releases, or build it yourself:

```powershell
git clone https://github.com/AlbertCJC/openclaude.git
cd openclaude
npm install
npm run dist
```

The installer is written to `dist-desktop/`. It isn't code-signed, so Windows SmartScreen will warn on first run.

## Development
```powershell
npm run dev            # web UI at http://localhost:3000
npm run desktop:build  # production build, then open the Electron window
node --experimental-strip-types scripts/check-jail.mjs   # workspace path-jail check
```

## Using it
1. Click **Add API key** in the top bar (or **Providers and API keys** in the sidebar).
2. Open a provider, click **Add key**, paste the key and save. Free keys: [OpenRouter](https://openrouter.ai/keys), [Groq](https://console.groq.com/keys), [Google AI Studio](https://aistudio.google.com/apikey), [NVIDIA NIM](https://build.nvidia.com/settings/api-keys).
3. Pick a model in the top bar. Models are written `provider-id/model-id`, for example `groq/llama-3.3-70b-versatile`.
4. Choose a workspace folder in the sidebar. File tools can't reach outside it.

## Where data is stored
- Settings and API keys: `%APPDATA%\openclaude\config.json` in the desktop app, or `data/config.json` when running `npm run dev`. Keys are stored as plain text for now; never commit this file.
- Desktop log: `%APPDATA%\openclaude\main.log`.

## Project layout
```
app/page.tsx          chat UI, artifact panel
app/Providers.tsx     providers and API key dialog
app/api/chat          agent loop (AI SDK streamText + tools + approvals)
app/api/config        read and save settings (keys masked)
app/api/models        list a provider's models
lib/config.ts         provider catalog and settings file
lib/tools.ts          tools and workspace path jail
electron/             desktop shell and preload
```

## Known limitations
- Chat history isn't saved yet.
- Models without native tool calling aren't supported yet.
- MCP connectors, skills, projects and memory are planned.
- See the security notes in the roadmap below before exposing the app to untrusted content.

## Roadmap
- Require a per-launch token on the local API so other programs can't call it.
- Block `web_fetch` from reaching local and private network addresses.
- Resolve symlinks in the workspace path check.
- Encrypt stored API keys with the OS keychain.
- Chat history, MCP connectors, skills, projects, memory.

## License
MIT, see [LICENSE](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

OpenClaude is an independent project and is not affiliated with Anthropic.
