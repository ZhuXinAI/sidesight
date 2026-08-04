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
- [x] Authenticate and publish the initial `sidesight@0.1.0` package.
- [x] Verify the `v0.1.1` tag-triggered trusted-publisher workflow.
- [x] Publish and verify the `v0.1.2` tag-triggered trusted-publisher workflow.

## CLI and agent UX hardening

- [x] Make the installed npm bin execute reliably through symlinks and expose root, command, and subcommand help without configuration.
- [x] Make the Agent Skill request user-controlled `npx sidesight setup` and prohibit credential discovery scans.
- [x] Document local paths, URLs, data URIs, clipboard input, and host attachment limitations in the skill and README.

## Post-release CLI UX

- [x] Make bare `npx sidesight setup` launch an interactive base URL, model, and API-key walkthrough while preserving flag-based automation.

## Explicit native OCR fallback

- [x] Add a provider-independent local OCR route for explicit `--provider local`, `--offline`, and `--ocr-backend system` requests.
- [x] Bundle a macOS Vision OCR bridge with secure temporary-file handling, normalized evidence, actionable missing-runtime errors, and no cloud request.
- [x] Document the agent install/setup conversation and explicit local OCR exception in the README and Agent Skill.
- [x] Add unit, acceptance, and package-asset coverage for local OCR routing and offline setup.
