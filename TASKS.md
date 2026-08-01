# SideSight implementation tasks

The PRD and `ACCEPTANCE.md` are authoritative. Tasks are ordered by dependency and are only checked after the implementation and validation evidence exists.

## Foundation

- [x] Create a strict TypeScript package with the `sidesight` executable, build, typecheck, test, lint, and packaging scripts.
- [x] Implement typed configuration resolution with CLI > environment > user config > profile defaults precedence.
- [x] Implement the shared task registry, prompt composition, result schema, Markdown output, and JSON output.

## Media and security

- [x] Implement local path allowlists, canonical path and symlink checks, size limits, MIME and magic-byte validation.
- [x] Implement remote HTTP/HTTPS loading with URL validation, DNS/private-network rejection, redirect revalidation, timeout, and response-size limits.
- [x] Implement image metadata, overview preprocessing, normalized region validation, and crops sourced from the original.
- [x] Implement bounded image detail/zoom behavior with deterministic early exit and evidence-region validation.
- [x] Implement bounded video frame sampling with ordered timestamps and an actionable ffmpeg-unavailable error.

## Provider and CLI

- [x] Implement the generic OpenAI-compatible multimodal chat-completions provider and the `opencode-go` profile.
- [x] Implement all eight image/video task commands with common options, stdin questions, output files, safe diagnostics, and actionable errors.
- [x] Implement `doctor`, `config init`, and `config show`.
- [x] Implement rerunnable `sidesight setup` with secure `~/.sidesight` persistence for provider URL, model, and API key.

## Adapters and distribution

- [x] Implement the stdio MCP server with the eight required tools over the shared engine.
- [x] Implement and test the single Codex-compatible SideSight Agent Skill and installer.
- [x] Write README, acceptance scenarios, and developer worklog matching the shipped behavior.

## Verification

- [x] Pass focused unit tests for configuration, prompts, media security, image processing, provider serialization, and output.
- [x] Pass mocked provider, real CLI, MCP stdio, acceptance, and package-installation checks.
- [x] Run full offline validation and record opt-in live-provider checks as skipped when credentials are unavailable.

## npm distribution

- [x] Add public npm metadata, version-aware package smoke checks, and a tag-triggered OIDC trusted-publisher workflow.
- [ ] Authenticate and publish the initial `sidesight@0.1.0` package.
- [ ] Connect the published package to the exact GitHub repository and `.github/workflows/publish.yml` trusted publisher.
