# SideSight acceptance scenarios

These scenarios are executable through the repository scripts. Live-provider scenarios are opt-in and must never be part of ordinary CI.

## Scenario: Install and invoke the CLI outside the source directory

### Steps

1. Run `pnpm test:pack`.
2. From the temporary installation directory, run `sidesight --help` and `sidesight --version`.

### Expected

- The executable is named `sidesight`.
- Help lists all required commands.
- Version prints the package version.
- Runtime files do not depend on the source checkout.

## Scenario: Diagnose an error screenshot with a mocked provider

### Preconditions

- The acceptance harness starts a local OpenAI-compatible mock provider.
- `SIDESIGHT_BASE_URL` and `SIDESIGHT_API_KEY` point to that provider.

### Steps

1. Run `sidesight diagnose test/fixtures/error.png --format json --question "Transcribe the exact error"`.
2. Capture stdout, stderr, and exit code.

### Expected

- Exit code is `0`.
- Stdout is one valid JSON object with `task: "diagnose"`.
- The answer comes from the provider response.
- Stderr contains no API key or base64 media.

## Scenario: Persist provider settings with setup

### Steps

1. Run `sidesight setup --base-url http://127.0.0.1:8000/v1 --model mock-vision --api-key test-key`.
2. Run `sidesight config show`.
3. Run `sidesight setup --model updated-model`.

### Expected

- Provider settings are saved under `~/.sidesight/config.json` unless `SIDESIGHT_CONFIG_FILE` or `SIDESIGHT_CONFIG_DIR` overrides the location.
- The saved file and containing directory are owner-restricted.
- `config show` reports that a key is configured without printing it.
- Rerunning setup preserves omitted settings.

## Scenario: All task presets share multimodal provider behavior

### Steps

1. Run the mocked image, UI, OCR, diagnose, diagram, chart, diff, and video equivalents.
2. Inspect the mock server request log.

### Expected

- Each task reaches the same provider adapter with its task-specific prompt.
- Diff sends both images in one logical request.
- The custom question and instructions file reach the provider.

## Scenario: Security boundaries reject unsafe media

### Steps

1. Run a command with a path outside the configured allowlist.
2. Run a command with a symlink escaping the allowlist.
3. Exercise private, localhost, metadata, unsupported-scheme, redirect-to-private, and oversized remote URLs.

### Expected

- Each request fails with a nonzero exit code and an actionable error.
- No provider request is made.
- Secrets and media payloads are absent from diagnostics.

## Scenario: MCP stdio tools use the shared engine

### Steps

1. Start `sidesight mcp` as a child process.
2. Send `initialize`, `tools/list`, and a tool call over JSON-RPC stdio.

### Expected

- Protocol messages are written to stdout only.
- Logs stay on stderr.
- The exact eight tool names are listed.
- Tool results include human-readable content and structured content.
- `npx -y sidesight mcp` uses the same entrypoint after package installation, and `SIDESIGHT_*` environment variables are inherited.

## Scenario: Skill routing

### Steps

1. Run `pnpm test:skill`.
2. Run `node scripts/install-skill.mjs <temporary-directory>`.

### Expected

- The skill routes each visual task to the documented CLI command.
- The installed skill is a real file, not a symlink.

## Scenario: Opt-in live provider checks

### Preconditions

- `SIDESIGHT_API_KEY`, `SIDESIGHT_BASE_URL`, and `SIDESIGHT_MODEL` are set.

### Steps

1. Run the documented live test command with `SIDESIGHT_LIVE_TEST=1`.

### Expected

- Without credentials, the check is explicitly reported as skipped.
- With credentials, the command verifies a multimodal response and never prints the key or image data.
