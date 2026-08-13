# ADR 0030: TypeScript 7 CLI And TypeScript 6 Compatibility API

Status: Proposed
Date: 2026-08-12

## Context

Issue [#245](https://github.com/ncolesummers/loopworks/issues/245) migrates
Loopworks from the JavaScript TypeScript 5 compiler to the native TypeScript 7
compiler. TypeScript 7 does not expose the compiler API used by the repository's
environment-access guard and metric-contract tests. Microsoft publishes
`@typescript/typescript6` as the supported transition API and explicitly supports
running it beside TypeScript 7.

The package names also compete for the conventional `tsc` binary. A dependency
layout that leaves resolution implicit could silently run TypeScript 6 even
while `package.json` appears to contain TypeScript 7.

## Decision

1. Install native TypeScript 7 under the conventional `typescript` package
   name. The repository's typecheck script invokes its `lib/tsc.js` entry
   explicitly, and Next.js 16.3 resolves the same package-local CLI during
   production builds. This avoids Bun's ambiguous `.bin/tsc` winner because the
   compatibility package also carries a transitive TypeScript 6 binary.
2. Install `@typescript/typescript6` explicitly. Repository-owned programmatic
   consumers import it directly and receive the stable TypeScript 6
   compatibility API. Patch its transitive TypeScript 6 package metadata and
   lockfile record to remove only the `tsc` and `tsserver` bin links; its API and
   the intentionally named `tsc6` compatibility command remain available.
3. Keep a repository test that verifies the exact dependency layout and
   typecheck script, executes the installed `tsc --version`, verifies Next.js
   resolves TypeScript 7, verifies the conventional `.bin/tsc` is TypeScript 7,
   and imports the compatibility API.
   Package-manager bin resolution is therefore an enforced contract, not an
   assumption.
4. Remove `baseUrl`, which TypeScript 7 no longer supports. The existing relative
   `paths` targets remain valid without it.
5. Remove the compatibility package once TypeScript 7 provides a stable
   compiler API and the repository's AST consumers have migrated to that API.

## Consequences

Repository-wide and Next.js production-build typechecking use the faster native
compiler while the two repository-owned AST consumers keep a supported
JavaScript API. Editors and third-party tools that resolve the `typescript`
package receive TypeScript 7 and must use CLI or language-server integrations
until TypeScript 7 provides its new programmatic API.

The project temporarily carries both compiler implementations and their
platform artifacts. Dependency updates must keep the split intact until the
removal condition is satisfied.

## Validation

1. `tests/unit/ci/typescript-toolchain.test.ts` verifies package layout, the
   canonical typecheck script, the native `tsc` version, Next.js resolution,
   compatibility API availability, and TypeScript 7-safe path configuration.
2. Environment-access and metric-contract tests exercise the compatibility API.
3. `bun run typecheck`, `bun run validate`, and `bun run build` exercise the
   native compiler in local and production-build paths.

## Follow-Ups

1. Issue [#246](https://github.com/ncolesummers/loopworks/issues/246), owned by
   the repository maintainers, tracks TypeScript 7's stable compiler API and
   removal of the TypeScript 6 compatibility package when both AST consumers
   can migrate.
2. Move this ADR to Accepted only after issue #245 review and merge.
