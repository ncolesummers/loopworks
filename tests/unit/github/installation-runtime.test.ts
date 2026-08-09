/** @vitest-environment node */

import {
  createGithubInstallationRuntime,
  readGithubInstallationConfig,
} from "@/lib/github/installation-runtime";

const validEnv = {
  GITHUB_APP_CLIENT_ID: "Iv1.loopworks",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  GITHUB_APP_ID: "124",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  GITHUB_APP_SLUG: "loopworks-app",
  LOOPWORKS_PUBLIC_URL: "https://loopworks.example",
};

describe("GitHub installation runtime", () => {
  it("reads the registered configuration and pins the exact callback URL", () => {
    expect(readGithubInstallationConfig(validEnv)).toEqual({
      appId: 124,
      callbackUrl: "https://loopworks.example/api/github/install/callback",
      clientId: "Iv1.loopworks",
      clientSecret: "client-secret",
      privateKey: "private-key",
      slug: "loopworks-app",
    });
  });

  it.each([
    { ...validEnv, GITHUB_APP_ID: "not-a-number" },
    { ...validEnv, GITHUB_APP_CLIENT_SECRET: "" },
    { ...validEnv, LOOPWORKS_PUBLIC_URL: "" },
  ])("rejects incomplete or malformed installation configuration", (env) => {
    expect(() => readGithubInstallationConfig(env)).toThrow();
  });

  it.each([
    "https://operator:secret@loopworks.example",
    "https://loopworks.example/base",
    "https://loopworks.example?tenant=other",
    "https://loopworks.example#callback",
    "ftp://loopworks.example",
  ])("rejects a non-canonical public origin: %s", (publicUrl) => {
    expect(() =>
      readGithubInstallationConfig({ ...validEnv, LOOPWORKS_PUBLIC_URL: publicUrl }),
    ).toThrow("LOOPWORKS_PUBLIC_URL must be an origin");
  });

  it("rejects an insecure production callback origin", () => {
    expect(() =>
      readGithubInstallationConfig({
        ...validEnv,
        LOOPWORKS_PUBLIC_URL: "http://loopworks.example",
        NODE_ENV: "production",
      }),
    ).toThrow("HTTPS");
  });

  it("allows an HTTP loopback callback origin outside production", () => {
    expect(
      readGithubInstallationConfig({
        ...validEnv,
        LOOPWORKS_PUBLIC_URL: "http://127.0.0.1:3000",
        NODE_ENV: "development",
      }).callbackUrl,
    ).toBe("http://127.0.0.1:3000/api/github/install/callback");
  });

  it("composes start, reconciliation, and callback operations without opening a network connection", () => {
    const runtime = createGithubInstallationRuntime(validEnv);

    expect(runtime).toEqual({
      callback: expect.any(Function),
      start: expect.any(Function),
      startReconciliation: expect.any(Function),
    });
  });
});
