# dsh-auto-codex-review

Experimental standalone fork of DeepSeek Harness Auto review that uses **`codex-auto-review` exclusively**, through the locally installed Codex CLI. The main agent’s provider and model are never used as a reviewer.

## What was reused

The MIT-licensed `@deepseek-ai/dsh-experimental-auto-review` baseline from DSH `0.2.0-rc.2` supplies the risk policy, filtered Session history, pending-action checks, and `tools/pre-execute` gate. The unmodified baseline is in [`upstream/`](upstream/). This is a package-level derivative, not a fork of the entire DSH monorepo.

This fork replaces DSH LLM inference with an isolated Codex CLI transport. Review denials are final rather than opening a manual-approval fallback; unloading the plugin moves Auto sessions to Read only.

## Requirements

- DSH `0.2.0-rc.2` services listed in `peerDependencies`; newer DSH APIs are not verified.
- Node.js `^22.19.0 || >=24.0.0`; macOS or Linux. Windows fails closed.
- A trusted local Codex CLI, authenticated with ChatGPT (`codex login`). CLI `0.159.0` was live-verified; CLI/backend compatibility is experimental.
- Account access to `codex-auto-review` and HTTPS access to `chatgpt.com`. No API-key or main-agent-provider fallback exists.

## Build and install

```sh
git clone https://github.com/TheSethRose/dsh-auto-codex-review.git
cd dsh-auto-codex-review
npm ci
npm pack
```

Install the generated `dsh-auto-codex-review-0.1.0.tgz` with your DSH profile’s package/bundle installer. The manifest declares `dsh.bundle.patch: cordis.patch.yml`, which loads the built `lib/index.js`. Installation does not change existing session presets: select **Auto** for the session you want reviewed. Disable the upstream Auto-review plugin first; both plugins must not own Auto simultaneously. This repository has not been published to the npm registry.

For manual Cordis composition, load the built entry after the existing Session, ToolRuntime, PermissionPreset, and agent-instructions services:

```yaml
- id: auto-codex-review
  name: /absolute/path/to/dsh-auto-codex-review/lib/index.js
  config:
    codexPath: codex
    timeoutMs: 120000
    maxBytes: 2097152
```

Configuration accepts only the following deployment options. The reviewer model, endpoint, policy, protocol, and CLI arguments are fixed.

| Option | Default | Meaning |
| --- | --- | --- |
| `codexPath` | `codex` | Trusted CLI executable path or PATH command |
| `timeoutMs` | `120000` | Positive integer overall review timeout, milliseconds |
| `maxBytes` | `2097152` | Positive integer per-channel transport/output byte limit |

Unknown fields, blank executable names, and nonpositive or noninteger limits fail at load. Numeric limits cannot exceed `2147483647`.

## Review behavior

- Low risk allows execution. Medium risk requires exact authorization from the current human request or the direct parent’s authorized task. High risk is denied.
- The reviewer sees the retained upstream policy and frozen project instructions, direct-parent task, filtered history, and exact pending action. Assistant reasoning and ordinary tool-result text are excluded.
- Malformed output, duplicate JSON keys, extra fields, unsupported risk values, CLI failure, timeout, and cancellation prevent the tool body from executing. Downstream guards still apply after reviewer approval.
- Native calls and PTC inner-tool dispatches use the same gate. The outer `run_code` wrapper is not reviewed. **Auto has no file sandbox**, and direct Node effects inside `run_code` bypass inner-tool review. Do not use Auto as an OS security boundary.
- Review denials and failures are returned through the tool runtime. Active reviews are cancelled and awaited on plugin disposal.

## Transport and privacy

Each review launches one ephemeral CLI process in a private temporary directory. User rules/config, project discovery, shell tools, MCP, hooks, plugins, apps, browser tools, and other context/tool features are disabled. A random loopback route reconstructs the upstream request with `model: "codex-auto-review"`, `tools: []`, and `tool_choice: "none"`; it discards CLI prompts and continuation metadata. Only text/reasoning SSE events are forwarded, and terminal completion is withheld until the whole upstream stream passes validation.

The CLI manages its existing ChatGPT login. The gateway transiently forwards bearer authentication and account routing to the fixed `https://chatgpt.com/backend-api/codex/responses` endpoint; plugin code does not read authentication storage, save those headers, or expose CLI stderr. Review content is sent to OpenAI. The plugin uses `store: false`, but that does not establish a server-side retention guarantee. Process launch requires trusting the selected CLI binary and the local user environment.

## Billing

OpenAI documents native ChatGPT-authenticated auto-review checks as free: [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan). That is a backend entitlement, not proof that arbitrary fixed-model CLI calls are free. **This fork does not claim free billing**, spoof Guardian headers, or attach native Guardian parent-response metadata. Verify account usage independently.

## Validation

```sh
npm run check       # Build and keyless regression tests
npm pack --dry-run  # Inspect the distributable payload
npm run test:live   # Opt-in: authenticated synthetic reviewer request
```

`test:live` uses `DSH_CODEX_PATH` if set, otherwise `codex`. It proposes a synthetic project-local text action but never executes it; successful output includes `"proposedActionExecuted":false`. Do not run it in credential-free CI. CI builds, runs the existing keyless tests, and packs on Node 22/24 for Linux/macOS.

## Known limitations

- Classification can be wrong; there are no persistent grants, retries, or deterministic tool exemptions.
- The private ChatGPT Responses endpoint, model availability, and Codex CLI flags can change. Unsupported changes fail closed.
- PTC direct effects and out-of-process child permissions remain outside this plugin’s control.
- The upstream synchronous Session reader and API compatibility assumptions are retained. Installation was exercised as a `link:` dependency in a live profile; the plugin-manager UI path has not been exercised.
- The permission picker's Auto entry and enable dialog use `permission.access` copy owned by the shipped `dsh-client-ui-permission-presets` client plugin, which still describes the built-in same-model reviewer. `client.js` rewrites those two strings at runtime and retries on every locale registration, because the shipped dictionary can register after this bundle activates. The shipped copy is left untouched when the locale internals are not as expected.

## License and maintenance

MIT. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and [`SECURITY.md`](SECURITY.md). Not affiliated with OpenAI or DeepSeek.
