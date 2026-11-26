# Third-party notices

OpenClaude is MIT licensed (see [LICENSE](LICENSE)). It depends on the open-source packages below, each under its own license. Full license texts ship inside each package in `node_modules/<package>/LICENSE`, and the desktop installer includes Electron's and Chromium's notices (`LICENSE.electron.txt`, `LICENSES.chromium.html`).

## Runtime dependencies
| Package | License |
|---|---|
| ai, @ai-sdk/openai-compatible, @ai-sdk/react (Vercel AI SDK) | Apache-2.0 |
| next | MIT |
| react, react-dom | MIT |
| react-markdown, remark-gfm | MIT |
| lucide-react | ISC |
| zod | MIT |

## Build and desktop tooling
| Package | License |
|---|---|
| electron (includes Chromium and Node.js) | MIT, plus bundled third-party licenses |
| electron-builder | MIT |
| typescript | Apache-2.0 |
| eslint, eslint-config-next, @eslint/eslintrc | MIT |
| @types/node, @types/react, @types/react-dom | MIT |

## Acknowledgements
The provider and API-key setup (one `*_API_KEY` per provider, numbered keys with fallback, `provider/model` naming, custom providers) follows the approach of [free-claude-code](https://github.com/Alishahryar1/free-claude-code). No code from that project is included.

"Claude" is a trademark of Anthropic. OpenClaude is an independent project and is not affiliated with or endorsed by Anthropic.
