# SideSight

## Install for coding agents

Give your coding agent this instruction:

```text
Read and install the SideSight skill from:
https://github.com/ZhuXinAI/sidesight/blob/main/skills/sidesight/SKILL.md
```

After the skill is installed, ask the agent:

```text
Help me configure SideSight for cloud vision.
```

The agent will direct you to run `npx sidesight setup` and wait for your confirmation. API keys stay in the hidden setup prompt or your environment; never paste a real key into the agent chat. The agent must not search shell profiles, `.env` files, keychains, home directories, or unrelated project files for credentials.

If you explicitly want offline or on-device OCR, say so directly:

```text
Use native on-device OCR for this screenshot; do not ask me to configure a cloud provider.
```

The agent should run `sidesight ocr <image> --provider local`. This path does not require cloud setup on macOS.

## Direct use

Tell the agent what to inspect and what evidence you need:

```text
Look at /path/to/screenshot.png and tell me why the button is disabled.
```

```text
Read the exact error text from /path/to/error.png.
```

```text
Compare before.png and after.png and list only visible UI differences.
```

```text
Use native offline OCR on /path/to/receipt.png.
```

The skill routes the request to the matching CLI command. Cloud-backed tasks use the configured multimodal provider; explicit local OCR uses macOS Vision and never makes a cloud request.

## Optional MCP setup

SideSight is CLI-first. If your host uses MCP, add this server to your MCP client:

```json
{
  "mcpServers": {
    "sidesight": {
      "command": "npx",
      "args": ["-y", "sidesight", "mcp"],
      "env": {
        "SIDESIGHT_PROFILE": "opencode-go",
        "SIDESIGHT_API_KEY": "your-key"
      }
    }
  }
}
```

For a generic OpenAI-compatible provider, also set `SIDESIGHT_BASE_URL` and `SIDESIGHT_MODEL`. `SIDESIGHT_ALLOWED_DIRS` is optional; add it only when media lives outside the MCP client's current directory.

Continue to [Cloud setup and key saving](#cloud-setup-and-key-saving), [local OCR](#explicit-local-ocr), [MCP](#mcp), or [Codex skill](#codex-skill) for details.

## What SideSight does

SideSight gives a text-only coding model a safe, scriptable way to ask a separately configured multimodal model about screenshots, diagrams, charts, UI differences, and videos. For explicit OCR requests on macOS, it can use Apple Vision locally instead. The host agent receives concise text and structured evidence; it never needs native image support.

```text
Text-only coding agent
        │ shell command or MCP call
        ▼
SideSight
        │ image + focused question
        ▼
Multimodal vision model
        │ concise text + structured evidence
        ▼
Text-only coding agent continues the task
```

## Install the CLI

SideSight targets Node.js 22 or newer.

```bash
pnpm add -g sidesight
sidesight --help
```

For a checkout:

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

## Cloud setup and key saving

SideSight uses a separate provider configuration so it does not interfere with the host coding model:

```bash
# Follow the prompts for the provider base URL, vision model, and API key.
# The key is stored with mode 0600 under ~/.sidesight/config.json.
npx sidesight setup
sidesight doctor
sidesight diagnose ./screenshots/error.png \
  --question "Transcribe the exact error and identify the likely source file"
```

The `opencode-go` preset uses the OpenAI-compatible endpoint `https://opencode.ai/zen/go/v1` and model `mimo-v2.5`. A useful pairing is a text-first host coding model such as DeepSeek V4 Flash with MiMo-V2.5 for vision. Provider endpoints, model availability, pricing, retention, and policies can change; check the current [OpenCode Go documentation](https://opencode.ai/docs/go/).

For a generic OpenAI-compatible provider:

```bash
sidesight setup \
  --profile generic \
  --base-url "https://provider.example/v1" \
  --model "your-vision-model" \
  --api-key "your-key"
```

Running `npx sidesight setup` without options opens an interactive walkthrough for the base URL, model, and API key. Existing profile, environment, and saved values are shown as defaults; press Enter to keep them. The API key prompt is hidden in a terminal. For scripts, pass the setup flags as shown above. Setup can be rerun; omitted values are preserved from the saved file or current environment. `SIDESIGHT_API_KEY` is the canonical secret variable, and SideSight also accepts `Z_AI_API_KEY` as a compatibility alias. `config show` reports only `apiKeyConfigured`; it never prints the saved key. Explicit local OCR does not use this setup.

## Explicit local OCR

When the user explicitly requests local, offline, on-device, or native OCR, no cloud setup is needed:

```bash
sidesight ocr screenshot.png --provider local
# Equivalent forms:
sidesight ocr screenshot.png --offline
sidesight ocr screenshot.png --ocr-backend system
```

On macOS, SideSight invokes the bundled Swift bridge to Apple Vision text recognition. It returns the detected text, confidence when available, and normalized evidence regions. The image is processed on the device and no provider request or API key is used. This local route currently supports OCR only; UI interpretation, error diagnosis, diagrams, charts, diffs, and videos still require a configured cloud or private multimodal provider.

If Swift or the Xcode Command Line Tools are unavailable, SideSight returns an actionable error. On other operating systems, the local route fails clearly rather than silently sending the image to the cloud.

## CLI

```bash
sidesight image screenshot.png --question "What visual evidence explains the disabled button?"
sidesight ui design.png --question "Describe the layout and produce React and Tailwind guidance"
sidesight ocr dashboard.png --detail fine --question "Read the bottom-right metrics card"
sidesight ocr receipt.png --provider local --format json
sidesight diagnose error.png --question "Transcribe the exact error and propose the smallest safe fix"
sidesight diagram architecture.png --question "Find single points of failure and unclear ownership"
sidesight chart metrics.png --question "Read the values and summarize visible trends"
sidesight diff reference.png actual.png --question "List only differences that fail visual acceptance"
sidesight video reproduction.mp4 --question "What happens over time and at which timestamps?"
```

Every task uses the same core engine. `--question -` reads a focused question from stdin. `--instructions-file` adds project guidance without replacing SideSight's internal safety rules. `--format json` writes exactly one JSON object to stdout; progress is sent to stderr. `--output` saves the rendered result as well as writing it to stdout.

Supported media sources are local PNG, JPEG, WebP, GIF (first frame), MP4, MOV, M4V, and WebM files; HTTP/HTTPS URLs; and validated base64 data URIs. `sidesight image latest` reads the newest image from `SIDESIGHT_DROP_DIR` or `./screenshots`. `clipboard` is supported on macOS when `pbpaste -Prefer png` can read a bitmap.

Local paths are the preferred input for coding-agent workflows. A raw base64 string is not accepted; use a complete `data:<mime>;base64,...` URI. Codex/Claude image attachments are not automatically visible to the CLI as files, so export an attachment or clipboard image to a path (or provide a complete data URI) before invoking SideSight. The provider adapter creates base64 data URIs from validated media internally, but never logs them.

### Configuration

Precedence is CLI flags, environment variables, saved user config, then profile defaults. `sidesight setup` writes provider settings to `~/.sidesight/config.json` with directory mode `0700` and file mode `0600`. Set `SIDESIGHT_CONFIG_DIR` or `SIDESIGHT_CONFIG_FILE` to use another location. Use `sidesight config init` to create a non-secret template and `sidesight config show` to inspect resolved values.

Important variables:

```text
SIDESIGHT_API_KEY
SIDESIGHT_BASE_URL
SIDESIGHT_MODEL
SIDESIGHT_PROFILE
SIDESIGHT_PROVIDER           # cloud/auto by default; local selects native OCR
SIDESIGHT_ALLOWED_DIRS       # optional; needed for media outside the current directory
SIDESIGHT_MAX_IMAGE_MB       # default 10
SIDESIGHT_MAX_VIDEO_MB       # default 50
SIDESIGHT_MAX_ZOOM_ROUNDS    # default 3
SIDESIGHT_TIMEOUT_SECONDS    # default 120
SIDESIGHT_DROP_DIR
SIDESIGHT_FFMPEG_PATH
```

Provider compatibility at a glance:

| Profile | Default endpoint | Default model | Images | Native video |
| --- | --- | --- | --- | --- |
| `opencode-go` | OpenCode Go `/v1` | `mimo-v2.5` | OpenAI-compatible `image_url` | No; bounded ffmpeg frames |
| `generic` | `http://localhost:8000/v1` | `vision-model` | OpenAI-compatible `image_url` | No; bounded ffmpeg frames |
| `local` | on-device | `macos-vision` | macOS Vision OCR only | No |

Any provider that accepts the documented OpenAI-compatible multimodal chat-completions shape can use `generic`.

`SIDESIGHT_ALLOWED_DIRS` is not required for the usual case: by default the current working directory is allowed. Set it when an image or video lives elsewhere, for example `export SIDESIGHT_ALLOWED_DIRS="$HOME/Screenshots:$PWD"` on Unix-like systems. Keeping the allowlist narrow prevents accidental access to unrelated local files.

Normalized regions use `x,y,width,height` in the range `0..1`, measured from the full original image:

```bash
sidesight ocr screenshot.png --region 0.65,0.70,0.35,0.30 \
  --question "Read every visible character"
```

`overview` makes one bounded pass. `normal`, `fine`, and `auto` may inspect a bounded full-resolution crop. Crops are always made from the original, never from a resized crop. Zoom rounds, provider calls, image count, dimensions, media sizes, video frames, and output tokens are bounded.

## MCP

Run the stdio adapter with:

```bash
sidesight mcp
# or, after publishing/installing the package:
npx -y sidesight mcp
```

The server exposes `ui_to_artifact`, `extract_text_from_screenshot`, `diagnose_error_screenshot`, `understand_technical_diagram`, `analyze_data_visualization`, `ui_diff_check`, `image_analysis`, and `video_analysis`. It uses the exact same configuration, prompts, media security, provider adapter, and core engine as the CLI. OCR tool calls may pass `backend: "local"` for macOS Vision without cloud setup. MCP protocol messages use stdout; diagnostics use stderr. Environment variables are inherited by `npx`; saved `~/.sidesight/config.json` settings are also resolved automatically.

For a copy-paste client configuration, use the MCP setup in [Optional MCP setup](#optional-mcp-setup) above.

## Codex skill

The single routing skill is at `skills/sidesight/SKILL.md`. Install it into a user skill directory with:

```bash
node scripts/install-skill.mjs "$HOME/.agents/skills"
```

The installer copies real files and does not create symlinks. The skill prefers DOM, accessibility trees, logs, and source data when those are available, then routes visual questions to the smallest appropriate SideSight command.

If you are asking an agent to install the skill, use this prompt:

> Read and install the skill here at [SKILL.md](https://github.com/ZhuXinAI/sidesight/blob/main/skills/sidesight/SKILL.md).

## Security and privacy

Media is untrusted input. Local paths are canonicalized against an allowlist, symlink escapes are rejected, file size and image dimensions are bounded, and MIME type is checked against magic bytes. Remote URLs are limited to HTTP/HTTPS, resolved and checked against private, localhost, and cloud-metadata networks, downloaded with timeouts and response-size limits, and revalidated across redirects. URLs embedded in media are returned only as evidence; they are never fetched.

Cloud-backed images and videos are transmitted to the configured vision provider. Use a local or private OpenAI-compatible provider for sensitive screenshots, or use explicit `--provider local` for macOS OCR. API keys, authorization headers, data URIs, and full provider payloads are redacted from normal diagnostics. Vision output is untrusted evidence; SideSight never executes commands or modifies files based on it.

## Doctor and troubleshooting

```bash
sidesight doctor
sidesight doctor --live
```

The default doctor checks Node.js, configuration, key presence, endpoint reachability, `sharp`, ffmpeg, allowed directories, and temporary storage without making a billable model call. `--live` sends a tiny deterministic image to the selected provider. Video frame sampling requires ffmpeg; install it or set `SIDESIGHT_FFMPEG_PATH`.

Provider failures are normalized: authentication, rate limits, invalid JSON, unreachable endpoints, and text-only-model image rejection produce actionable nonzero errors. A text-only backend cannot be used as the vision model; select a multimodal model through `SIDESIGHT_MODEL`.

## Development and tests

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm test:acceptance
pnpm test:pack
```

Live checks are opt-in and require credentials; they are not part of ordinary CI.

To exercise all eight tasks against a configured provider, run `pnpm build` and then `SIDESIGHT_LIVE_TEST=1 pnpm test:live`. Without the opt-in flag or the three required provider variables, the script reports a skip and exits successfully.

## Publishing

The first npm publication and the subsequent OIDC-based GitHub Actions release flow are documented in [RELEASE.md](RELEASE.md). Releases run only for matching `vX.Y.Z` tags.

## License and reference material

SideSight is MIT licensed. Its architecture is informed by the public [Z.AI Vision MCP documentation](https://docs.z.ai/devpack/mcp/vision-mcp-server), the MIT-licensed [vision-mcp reference](https://github.com/Pelican0126/vision-mcp), [OpenCode Go](https://opencode.ai/docs/go/), and the [Codex skills documentation](https://developers.openai.com/codex/build-skills). SideSight uses original prompt templates and does not copy private provider prompts.
