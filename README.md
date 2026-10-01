<p align="center">
  <img src="assets/coworker-logo.png" alt="CoworkerAPI" width="112" />
</p>

<h1 align="center">CoworkerAPI</h1>

<p align="center">A local gateway that turns ChatGPT's official MCP connection into OpenAI-compatible and Anthropic-compatible endpoints.</p>

<p align="center"><a href="https://github.com/dat-hoangnguyentuandat/coworkerAPI/releases"><img src="https://img.shields.io/badge/release-1.0.0-111827" alt="Release 1.0.0"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-111827" alt="MIT license"></a> <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-22.14%2B-111827" alt="Node.js 22.14 or newer"></a></p>

CoworkerAPI lets Claude Code, Codex CLI, OpenCode, Cursor, VS Code and other custom-provider clients use a ChatGPT account through standard API surfaces. The ChatGPT web interface remains the upstream connection; CoworkerAPI handles protocol translation, authentication, request lifecycle and MCP callbacks locally.

```text
Client → OpenAI / Anthropic endpoint → CoworkerAPI → ChatGPT MCP widget
       ← protocol response          ← ChatGPT answer / client tool call
```

## Install on Windows

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/dat-hoangnguyentuandat/coworkerAPI/main/scripts/install.ps1 | iex
```

The installer checks Node.js, downloads the source, builds the gateway and adds the `coworkerapi` launcher to the global npm command directory. It keeps configuration in `%LOCALAPPDATA%\coworkerapi` and never overwrites an existing `.env` or runtime data.

Then start the dashboard:

```powershell
coworkerapi
```

The initial local password is `123456`. Follow the dashboard guide to connect the ChatGPT plugin, activate the bridge and create an API key. For a foreground service, use `coworkerapi start`.

## Requirements

- Node.js 22.14 or newer
- A ChatGPT account with MCP Apps / connected-plugin access
- The official tunnel client when ChatGPT must reach a gateway outside localhost

Windows is the primary supported platform. The same source can be installed manually on macOS, Linux and Termux with Node.js 22.14+.

## Endpoints

With the default port `3211`:

| Client | Base URL | Authentication |
| --- | --- | --- |
| OpenAI Responses / Chat Completions | `http://127.0.0.1:3211/v1` | `Authorization: Bearer <API_KEY>` |
| Anthropic Messages | `http://127.0.0.1:3211` | `x-api-key: <API_KEY>` |
| ChatGPT MCP | `http://127.0.0.1:3211/mcp` | MCP secret / tunnel |

Supported routes include `POST /v1/responses`, `POST /v1/chat/completions`, `POST /v1/messages` and authenticated `GET /v1/models`.

## Client setup

Claude Code can use the Anthropic-compatible endpoint:

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:3211"
$env:ANTHROPIC_AUTH_TOKEN = "<API_KEY>"
claude
```

OpenAI-compatible clients use `http://127.0.0.1:3211/v1` and a Bearer API key. Cursor, VS Code, OpenCode, Codex CLI and other custom-provider clients use the same values wherever they support a custom endpoint.

## Launcher commands

```text
coworkerapi          # interactive launcher
coworkerapi web      # open dashboard and keep the service running
coworkerapi start    # run the service in the foreground
coworkerapi doctor   # inspect gateway, MCP and tunnel health
coworkerapi version  # print the installed version
```

The dashboard includes bilingual English/Vietnamese onboarding, tunnel setup, API-key management, model aliases, provider settings, request logs, usage metrics, limits and live updates.

## Manual development setup

```powershell
cd coworkerAPI-dashboard
npm ci
npm test
npm run build
node bin/coworkerapi.mjs init
node bin/coworkerapi.mjs start
```

Copy `.env.example` only when manual environment configuration is required. The dashboard stores credentials encrypted. Never commit `.env`, API keys, tunnel credentials, browser sessions or runtime data.

## Bridge setup

1. Open **Connections** in the dashboard and configure the tunnel when required.
2. Connect the ChatGPT plugin/MCP endpoint shown by the dashboard.
3. Open the bridge link, send the pre-filled activation message and wait for **Ready**.
4. Create an API key under **API keys**.
5. Configure the endpoint and key in your client.

Stable MCP tools are `workbench_api_activate`, `workbench_api_poll`, `workbench_api_read_request` and `workbench_api_submit`.

## Updating and uninstalling

Run the install command again to update application files; the installer preserves `%LOCALAPPDATA%\coworkerapi\.env` and `data`. To remove the launcher, delete `coworkerapi.cmd` and `coworkerapi.ps1` from the global npm command directory. Remove the application directory only after exporting any configuration or data you need.

## License

MIT. See [LICENSE](LICENSE).
