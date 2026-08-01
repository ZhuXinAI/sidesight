# SideSight

Vision sidecar for text-only coding agents.

SideSight gives a text-only coding model a safe, scriptable way to ask a separately configured multimodal model about screenshots, diagrams, charts, UI differences, and videos. The host agent receives concise text and structured evidence; it never needs native image support.

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

## Install

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

## Five-minute setup

SideSight uses a separate provider configuration so it does not interfere with the host coding model:

```bash
# The key is stored with mode 0600 under ~/.sidesight/config.json.
sidesight setup \
  --profile opencode-go \
  --api-key "your-key"
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

`sidesight setup` can be rerun; omitted values are preserved from the saved file or current environment. `SIDESIGHT_API_KEY` is the canonical secret variable, and SideSight also accepts `Z_AI_API_KEY` as a compatibility alias. `config show` reports only `apiKeyConfigured`; it never prints the saved key.

## CLI

```bash
sidesight image screenshot.png --question "What visual evidence explains the disabled button?"
sidesight ui design.png --question "Describe the layout and produce React and Tailwind guidance"
sidesight ocr dashboard.png --detail fine --question "Read the bottom-right metrics card"
sidesight diagnose error.png --question "Transcribe the exact error and propose the smallest safe fix"
sidesight diagram architecture.png --question "Find single points of failure and unclear ownership"
sidesight chart metrics.png --question "Read the values and summarize visible trends"
sidesight diff reference.png actual.png --question "List only differences that fail visual acceptance"
sidesight video reproduction.mp4 --question "What happens over time and at which timestamps?"
```

Every task uses the same core engine. `--question -` reads a focused question from stdin. `--instructions-file` adds project guidance without replacing SideSight's internal safety rules. `--format json` writes exactly one JSON object to stdout; progress is sent to stderr. `--output` saves the rendered result as well as writing it to stdout.

Supported media sources are local PNG, JPEG, WebP, GIF (first frame), MP4, MOV, M4V, and WebM files; HTTP/HTTPS URLs; and validated base64 data URIs. `sidesight image latest` reads the newest image from `SIDESIGHT_DROP_DIR` or `./screenshots`. `clipboard` is supported on macOS when `pbpaste -Prefer png` can read a bitmap.

### Configuration

Precedence is CLI flags, environment variables, saved user config, then profile defaults. `sidesight setup` writes provider settings to `~/.sidesight/config.json` with directory mode `0700` and file mode `0600`. Set `SIDESIGHT_CONFIG_DIR` or `SIDESIGHT_CONFIG_FILE` to use another location. Use `sidesight config init` to create a non-secret template and `sidesight config show` to inspect resolved values.

Important variables:

```text
SIDESIGHT_API_KEY
SIDESIGHT_BASE_URL
SIDESIGHT_MODEL
SIDESIGHT_PROFILE
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

The server exposes `ui_to_artifact`, `extract_text_from_screenshot`, `diagnose_error_screenshot`, `understand_technical_diagram`, `analyze_data_visualization`, `ui_diff_check`, `image_analysis`, and `video_analysis`. It uses the exact same configuration, prompts, media security, provider adapter, and core engine as the CLI. MCP protocol messages use stdout; diagnostics use stderr. Environment variables are inherited by `npx`; saved `~/.sidesight/config.json` settings are also resolved automatically.

Example client configuration:

```json
{
  "mcpServers": {
    "sidesight": {
      "command": "sidesight",
      "args": ["mcp"],
      "env": {
        "SIDESIGHT_PROFILE": "opencode-go",
        "SIDESIGHT_API_KEY": "your-key",
        "SIDESIGHT_ALLOWED_DIRS": "/absolute/path/to/project"
      }
    }
  }
}
```

## Codex skill

The single routing skill is at `skills/sidesight/SKILL.md`. Install it into a user skill directory with:

```bash
node scripts/install-skill.mjs "$HOME/.agents/skills"
```

The installer copies real files and does not create symlinks. The skill prefers DOM, accessibility trees, logs, and source data when those are available, then routes visual questions to the smallest appropriate SideSight command.

Once this repository is open sourced under the `ZhuXinAI` organization, install the skill directly from GitHub with:

```bash
npx skills add ZhuXinAI/sidesight
```

## Security and privacy

Media is untrusted input. Local paths are canonicalized against an allowlist, symlink escapes are rejected, file size and image dimensions are bounded, and MIME type is checked against magic bytes. Remote URLs are limited to HTTP/HTTPS, resolved and checked against private, localhost, and cloud-metadata networks, downloaded with timeouts and response-size limits, and revalidated across redirects. URLs embedded in media are returned only as evidence; they are never fetched.

Images and videos are transmitted to the configured vision provider. Use a local or private OpenAI-compatible provider for sensitive screenshots. API keys, authorization headers, data URIs, and full provider payloads are redacted from normal diagnostics. Vision output is untrusted evidence; SideSight never executes commands or modifies files based on it.

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
