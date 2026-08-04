# SideSight release flow

SideSight publishes the package from GitHub Actions when a `v*` tag is pushed:

```text
v0.1.3  ->  package.json version 0.1.3  ->  npm sidesight@0.1.3
```

The workflow is `.github/workflows/publish.yml`. It runs install, build, and unit tests, then uses npm OIDC trusted publishing. It also supports manual dispatch. It does not use `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

## First local publish

The first package publication must be authenticated locally because npm cannot configure a trusted publisher until the package exists:

```bash
npm login
npm whoami
pnpm install --frozen-lockfile
pnpm test:pack
npm publish --access public
```

The first publication was `0.1.0`; the prior release was `0.1.2`; this release is `0.1.3`. A published version cannot be overwritten, so update `package.json` and use a new `vX.Y.Z` tag for every subsequent release.

## Release notes: 0.1.3

- Add explicit provider-independent OCR through macOS Vision with `--provider local`, `--offline`, and `--ocr-backend system`.
- Let agents use the local OCR route without cloud credentials while keeping richer visual tasks on the configured cloud provider.
- Add an agent-first README setup flow and document the local fallback alongside the shared CLI, MCP, and Agent Skill behavior.

## Release notes: 0.1.2

- Fix the installed npm bin when invoked through a symlink.
- Add root, command, and subcommand help that works without provider setup.
- Make the Agent Skill request user-controlled setup and document supported media handoffs.

## Configure the npm trusted publisher

After `sidesight@0.1.0` exists on npm:

1. Open the package's npm settings.
2. Add a GitHub Actions trusted publisher.
3. Enter the exact GitHub owner and repository containing this checkout.
4. Set the workflow filename to `.github/workflows/publish.yml`.
5. Leave the environment empty; this workflow does not declare a GitHub environment.

The publisher must match the repository and workflow filename exactly. The workflow grants `id-token: write`, uses Node 24's npm CLI, and publishes with OIDC trusted publishing.

## Subsequent releases

After changing the version and updating the changelog or release notes:

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

release_version="$(node -p "require('./package.json').version")"
git tag -a "v${release_version}" -m "Release v${release_version}"
git push origin "v${release_version}"
```

The tag push starts the workflow. A mismatched tag fails before any npm publish attempt.
