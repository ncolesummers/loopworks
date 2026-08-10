import { configRegistry } from "@/lib/config/registry";
import {
  diffVercelEnv,
  envTargetDirective,
  parseEnvFile,
  parseVercelEnvNames,
  providerManagedConfigNames,
  requiredVercelConfigNames,
  validateVercelEnvFile,
} from "../../../scripts/sync-vercel-env";

// Trimmed from real `vercel env ls preview` output. The value column is always
// the literal "Encrypted" for a secret, so a parser that reads names can never
// surface a value even when the fixture is a live capture.
const previewListing = `
Vercel CLI 58.5.1 (Node.js 26.7.0)
Retrieving project…
> Environment Variables found for ncolesummers-projects/loopworks [126ms]

 name                                       value               environments                created
 OTEL_SERVICE_NAME                          Encrypted           Preview, Production         37d ago
 DATABASE_URL                               Encrypted           Production, Preview         37d ago
 AUTH_SECRET                                Encrypted           Preview                     37d ago
 LOOPWORKS_AUTH_BYPASS                      Encrypted           Preview                     37d ago

Common next commands:
- \`vercel env add\`
- \`vercel env rm\`
`;

function previewEnvFile(overrides: Record<string, string> = {}): string {
  const entries: Record<string, string> = {
    [envTargetDirective]: "preview",
    AUTH_SECRET: "preview-auth-secret",
    AUTH_GITHUB_ID: "preview-oauth-client-id",
    AUTH_GITHUB_SECRET: "preview-oauth-client-secret",
    LOOPWORKS_PUBLIC_URL: "https://loopworks-preview.vercel.app",
    LOOPWORKS_ALLOWED_GITHUB_USERS: "ncolesummers",
    LOOPWORKS_EVE_TEST_RECEIPT_SECRET: "preview-receipt-secret",
    GITHUB_APP_ID: "654321",
    GITHUB_APP_CLIENT_ID: "preview-app-client-id",
    GITHUB_APP_CLIENT_SECRET: "preview-app-client-secret",
    GITHUB_APP_PRIVATE_KEY:
      "-----BEGIN RSA PRIVATE KEY-----\\npreview-key-body\\n-----END RSA PRIVATE KEY-----",
    GITHUB_APP_SLUG: "loopworks-preview",
    GITHUB_WEBHOOK_SECRET: "preview-webhook-secret",
    ...overrides,
  };
  return Object.entries(entries)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `${name}="${value}"`)
    .join("\n");
}

describe("sync-vercel-env", () => {
  describe("requiredVercelConfigNames", () => {
    it("derives the contract from the registry's production-required entries", () => {
      const required = requiredVercelConfigNames();

      expect(required).toEqual(
        configRegistry
          .filter(
            (entry) =>
              (entry.requiredIn as readonly string[]).includes("production") &&
              !entry.readOnly &&
              !providerManagedConfigNames.includes(entry.name as never),
          )
          .map((entry) => entry.name),
      );
      expect(required).toContain("AUTH_GITHUB_ID");
      expect(required).toContain("GITHUB_APP_PRIVATE_KEY");
    });

    it("excludes provider-managed database URLs the Neon integration injects", () => {
      expect(requiredVercelConfigNames()).not.toContain("DATABASE_URL");
      expect(requiredVercelConfigNames()).not.toContain("DATABASE_URL_UNPOOLED");
    });

    it("does not require optional deployment-visibility configuration", () => {
      expect(requiredVercelConfigNames()).not.toContain("VERCEL_ACCESS_TOKEN");
    });
  });

  describe("parseVercelEnvNames", () => {
    it("reads variable names and never the value column", () => {
      const names = parseVercelEnvNames(previewListing);

      expect(names).toEqual([
        "OTEL_SERVICE_NAME",
        "DATABASE_URL",
        "AUTH_SECRET",
        "LOOPWORKS_AUTH_BYPASS",
      ]);
      expect(names.join(" ")).not.toContain("Encrypted");
    });

    it("ignores the header, banner, and next-command chrome", () => {
      expect(parseVercelEnvNames(previewListing)).not.toContain("name");
      expect(parseVercelEnvNames("Vercel CLI 58.5.1\n\nCommon next commands:\n")).toEqual([]);
    });
  });

  describe("diffVercelEnv", () => {
    it("reports the preview variables the issue found missing", () => {
      const diff = diffVercelEnv({
        required: requiredVercelConfigNames(),
        present: parseVercelEnvNames(previewListing),
      });

      expect(diff.missing).toContain("AUTH_GITHUB_ID");
      expect(diff.missing).toContain("GITHUB_APP_SLUG");
      expect(diff.present).toContain("AUTH_SECRET");
      expect(diff.missing).not.toContain("AUTH_SECRET");
    });

    it("reports no missing names once every required variable is set", () => {
      const present = requiredVercelConfigNames();
      expect(diffVercelEnv({ required: present, present }).missing).toEqual([]);
    });
  });

  describe("parseEnvFile", () => {
    it("reads quoted and bare assignments and skips comments", () => {
      const entries = parseEnvFile('# comment\nA="one"\n\nB=two\nC="say \\"hi\\""\n');

      expect(entries.get("A")).toBe("one");
      expect(entries.get("B")).toBe("two");
      expect(entries.get("C")).toBe('say "hi"');
      expect(entries.has("# comment")).toBe(false);
    });

    it("preserves escaped newlines used by PEM private keys", () => {
      expect(parseEnvFile('GITHUB_APP_PRIVATE_KEY="a\\nb"').get("GITHUB_APP_PRIVATE_KEY")).toBe(
        "a\nb",
      );
    });
  });

  describe("validateVercelEnvFile", () => {
    it("accepts a complete preview file and strips the target directive", () => {
      const entries = validateVercelEnvFile(previewEnvFile(), "preview");

      expect(entries.has(envTargetDirective)).toBe(false);
      expect(entries.get("GITHUB_APP_SLUG")).toBe("loopworks-preview");
      for (const name of requiredVercelConfigNames()) expect(entries.has(name)).toBe(true);
    });

    it("refuses an env file whose declared target is a different environment", () => {
      expect(() => validateVercelEnvFile(previewEnvFile(), "production")).toThrow(
        /declares target "preview"/,
      );
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ [envTargetDirective]: "" }), "preview"),
      ).toThrow(/must declare LOOPWORKS_ENV_TARGET/);
    });

    it("names every missing required variable without printing any value", () => {
      let thrown: Error | undefined;
      try {
        validateVercelEnvFile(
          previewEnvFile({ AUTH_GITHUB_ID: "", GITHUB_APP_SLUG: "" }),
          "preview",
        );
      } catch (error) {
        thrown = error as Error;
      }

      expect(thrown?.message).toContain("AUTH_GITHUB_ID");
      expect(thrown?.message).toContain("GITHUB_APP_SLUG");
      expect(thrown?.message).not.toContain("preview-auth-secret");
    });

    it("rejects provider-managed and unknown names", () => {
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ DATABASE_URL: "postgres://h/d" }), "preview"),
      ).toThrow(/DATABASE_URL/);
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ NOT_A_REAL_NAME: "x" }), "preview"),
      ).toThrow(/NOT_A_REAL_NAME/);
    });

    it("rejects a preview file that disables the application auth boundary", () => {
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ LOOPWORKS_AUTH_BYPASS: "true" }), "preview"),
      ).toThrow(/LOOPWORKS_AUTH_BYPASS/);
    });

    it("rejects a preview file with no allowlisted GitHub user or organization", () => {
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ LOOPWORKS_ALLOWED_GITHUB_USERS: "" }), "preview"),
      ).toThrow(/allowlist/);
    });

    // The App ID sits directly above the Client ID on the GitHub App settings
    // page. Pasting it into either client field yields a GitHub 404 at
    // /login/oauth/authorize, twenty minutes and one redeploy later.
    it("rejects an all-digits client id, which is always the App ID", () => {
      for (const name of ["AUTH_GITHUB_ID", "GITHUB_APP_CLIENT_ID"]) {
        expect(() =>
          validateVercelEnvFile(previewEnvFile({ [name]: "4542534" }), "preview"),
        ).toThrow(new RegExp(`${name}.*App ID`));
      }
    });

    it("accepts a real GitHub App client id", () => {
      const entries = validateVercelEnvFile(
        previewEnvFile({
          AUTH_GITHUB_ID: "Iv23li-preview-client-id",
          GITHUB_APP_CLIENT_ID: "Iv23li-preview-client-id",
        }),
        "preview",
      );

      expect(entries.get("AUTH_GITHUB_ID")).toBe("Iv23li-preview-client-id");
    });

    it("still requires GITHUB_APP_ID itself to be numeric", () => {
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ GITHUB_APP_ID: "4542534" }), "preview"),
      ).not.toThrow();
    });

    // The example documents a `$(awk ...)` one-liner for the PEM. Pasted into
    // the file instead of run in a shell, it stores the command text, and the
    // App JWT then fails at runtime as an opaque /settings?github=error.
    it("rejects a private key that is not a PEM", () => {
      for (const value of [
        `"$(awk 'BEGIN{ORS="\\n"}1' ~/Downloads/app.private-key.pem)"`,
        "~/Downloads/app.private-key.pem",
        "not-a-key",
      ]) {
        expect(() =>
          validateVercelEnvFile(previewEnvFile({ GITHUB_APP_PRIVATE_KEY: value }), "preview"),
        ).toThrow(/GITHUB_APP_PRIVATE_KEY.*PEM/);
      }
    });

    it("accepts a PEM with escaped or real newlines", () => {
      const pem = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEow==\\n-----END RSA PRIVATE KEY-----";
      expect(() =>
        validateVercelEnvFile(previewEnvFile({ GITHUB_APP_PRIVATE_KEY: pem }), "preview"),
      ).not.toThrow();
    });

    it("rejects generated example placeholders and non-HTTPS public origins", () => {
      expect(() =>
        validateVercelEnvFile(
          previewEnvFile({ GITHUB_APP_SLUG: "replace-with-github-app-slug" }),
          "preview",
        ),
      ).toThrow(/GITHUB_APP_SLUG/);
      expect(() =>
        validateVercelEnvFile(
          previewEnvFile({ LOOPWORKS_PUBLIC_URL: "http://loopworks-preview.vercel.app" }),
          "preview",
        ),
      ).toThrow(/LOOPWORKS_PUBLIC_URL/);
    });
  });
});
