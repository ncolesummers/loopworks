/** @vitest-environment node */
import { readFileSync } from "node:fs";

const readme = readFileSync("README.md", "utf8");

describe("README maintainer contract", () => {
  it("stays a concise project front door", () => {
    expect(readme).toContain("## Status");
    expect(readme).toContain("## Quick start");
    expect(readme).toContain("## Validation");
    expect(readme).toContain("## Contributing");
    expect(readme).toContain("## Documentation");
    expect(readme).toContain("## License");
  });

  it("links to canonical detail instead of duplicating operations", () => {
    expect(readme).toContain("[`.env.example`](.env.example)");
    expect(readme).toContain("[contribution guide](CONTRIBUTING.MD)");
    expect(readme).toContain("[development guide](docs/development.md)");
    expect(readme).toContain("[Vercel and Neon runbook](docs/runbooks/vercel-neon-deployment.md)");
    expect(readme).toContain("[architecture](docs/architecture.md)");
    expect(readme).toContain("[ADR index](docs/adr/README.md)");

    expect(readme).not.toMatch(/^## Environment$/m);
    expect(readme).not.toMatch(/^### Hosted Neon deployment$/m);
    expect(readme).not.toMatch(/^### Pre-production migration resets$/m);
    expect(readme).not.toMatch(/^## Git Hooks$/m);
    expect(readme).not.toMatch(/^## Database Seed Data$/m);
    expect(readme).not.toMatch(/^\s*[-*]\s+`[A-Z][A-Z0-9_]+`\s*$/m);
  });
});
