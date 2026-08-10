import { HttpResponse, http } from "msw";
import {
  assignDeploymentAlias,
  fetchProjectDeployments,
  parseAliasHost,
  previewAliasComment,
  readVercelProjectLink,
  resolveVercelProjectLink,
  selectPreviewDeployment,
  type VercelDeploymentSummary,
} from "../../../scripts/vercel-preview-alias";
import { mswServer } from "../../helpers/msw";

const headSha = "0bf80d1aa1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";
const olderSha = "1111111111111111111111111111111111111111";

function deployment(overrides: Partial<VercelDeploymentSummary> = {}): VercelDeploymentSummary {
  return {
    uid: "dpl_ready",
    url: "loopworks-git-branch-hash.vercel.app",
    created: 200,
    readyState: "READY",
    target: null,
    meta: { githubCommitSha: headSha },
    ...overrides,
  };
}

describe("vercel-preview-alias", () => {
  describe("readVercelProjectLink", () => {
    it("reads the linked project and org from .vercel/repo.json", () => {
      const link = readVercelProjectLink(
        JSON.stringify({
          remoteName: "origin",
          projects: [{ id: "prj_abc", name: "loopworks", directory: ".", orgId: "team_xyz" }],
        }),
      );

      expect(link).toEqual({ projectId: "prj_abc", orgId: "team_xyz" });
    });

    it("fails closed when the repository is not linked", () => {
      expect(() => readVercelProjectLink(JSON.stringify({ projects: [] }))).toThrow(/not linked/i);
      expect(() => readVercelProjectLink("not json")).toThrow();
    });
  });

  describe("resolveVercelProjectLink", () => {
    // `.vercel/` is gitignored, so CI never has the linked-project file.
    it("prefers explicit identifiers over the linked-project file", () => {
      expect(
        resolveVercelProjectLink({
          projectId: "prj_ci",
          orgId: "team_ci",
          repoJson: JSON.stringify({ projects: [{ id: "prj_local", orgId: "team_local" }] }),
        }),
      ).toEqual({ projectId: "prj_ci", orgId: "team_ci" });
    });

    it("falls back to the linked-project file when identifiers are absent", () => {
      expect(
        resolveVercelProjectLink({
          repoJson: JSON.stringify({ projects: [{ id: "prj_local", orgId: "team_local" }] }),
        }),
      ).toEqual({ projectId: "prj_local", orgId: "team_local" });
    });

    it("fails closed when neither source is available", () => {
      expect(() => resolveVercelProjectLink({})).toThrow(/--project-id/);
      expect(() => resolveVercelProjectLink({ projectId: "prj_ci" })).toThrow(/--project-id/);
    });
  });

  describe("parseAliasHost", () => {
    it("accepts a bare hostname", () => {
      expect(parseAliasHost("loopworks-preview.vercel.app")).toBe("loopworks-preview.vercel.app");
      expect(parseAliasHost("  loopworks-preview.vercel.app  ")).toBe(
        "loopworks-preview.vercel.app",
      );
    });

    it("rejects a scheme, a path, or an empty value", () => {
      expect(() => parseAliasHost("https://loopworks-preview.vercel.app")).toThrow(/hostname/i);
      expect(() => parseAliasHost("loopworks-preview.vercel.app/settings")).toThrow(/hostname/i);
      expect(() => parseAliasHost("")).toThrow(/hostname/i);
    });
  });

  describe("selectPreviewDeployment", () => {
    it("selects the newest ready preview deployment for the commit", () => {
      const newest = deployment({ uid: "dpl_newest", created: 300 });

      expect(
        selectPreviewDeployment(
          [deployment({ uid: "dpl_older", created: 100 }), newest, deployment({ created: 200 })],
          { commitSha: headSha },
        ),
      ).toBe(newest);
    });

    it("ignores deployments for another commit", () => {
      expect(
        selectPreviewDeployment([deployment({ meta: { githubCommitSha: olderSha } })], {
          commitSha: headSha,
        }),
      ).toBeUndefined();
    });

    it("ignores deployments that are not ready yet", () => {
      for (const readyState of ["BUILDING", "QUEUED", "ERROR", "CANCELED"]) {
        expect(
          selectPreviewDeployment([deployment({ readyState })], { commitSha: headSha }),
        ).toBeUndefined();
      }
    });

    it("never aliases a production deployment", () => {
      expect(
        selectPreviewDeployment([deployment({ target: "production" })], { commitSha: headSha }),
      ).toBeUndefined();
    });

    it("accepts either the state or readyState field the API may return", () => {
      expect(
        selectPreviewDeployment([{ ...deployment(), readyState: undefined, state: "READY" }], {
          commitSha: headSha,
        }),
      ).toBeDefined();
    });
  });

  describe("fetchProjectDeployments", () => {
    it("requests the project's preview deployments with the bearer token", async () => {
      let authorization: string | null = null;
      let requestUrl: URL | undefined;
      mswServer.use(
        http.get("https://api.vercel.com/v6/deployments", ({ request }) => {
          authorization = request.headers.get("authorization");
          requestUrl = new URL(request.url);
          return HttpResponse.json({ deployments: [deployment()] });
        }),
      );

      const deployments = await fetchProjectDeployments({
        token: "vercel-token",
        projectId: "prj_abc",
        orgId: "team_xyz",
      });

      expect(deployments).toHaveLength(1);
      expect(authorization).toBe("Bearer vercel-token");
      expect(requestUrl?.searchParams.get("projectId")).toBe("prj_abc");
      expect(requestUrl?.searchParams.get("teamId")).toBe("team_xyz");
      expect(requestUrl?.searchParams.get("target")).toBe("preview");
    });

    it("throws without echoing the token when the API rejects the request", async () => {
      mswServer.use(
        http.get("https://api.vercel.com/v6/deployments", () =>
          HttpResponse.json({ error: { message: "forbidden" } }, { status: 403 }),
        ),
      );

      await expect(
        fetchProjectDeployments({ token: "vercel-token", projectId: "prj_abc", orgId: "team_xyz" }),
      ).rejects.toThrow(/403/);
      await expect(
        fetchProjectDeployments({ token: "vercel-token", projectId: "prj_abc", orgId: "team_xyz" }),
      ).rejects.not.toThrow(/vercel-token/);
    });
  });

  describe("assignDeploymentAlias", () => {
    it("posts the alias to the deployment within the linked team", async () => {
      let body: unknown;
      let requestUrl: URL | undefined;
      mswServer.use(
        http.post(
          "https://api.vercel.com/v2/deployments/:id/aliases",
          async ({ request, params }) => {
            body = await request.json();
            requestUrl = new URL(request.url);
            expect(params.id).toBe("dpl_ready");
            return HttpResponse.json({ uid: "alias_1" });
          },
        ),
      );

      await assignDeploymentAlias({
        token: "vercel-token",
        orgId: "team_xyz",
        deploymentId: "dpl_ready",
        alias: "loopworks-preview.vercel.app",
      });

      expect(body).toEqual({ alias: "loopworks-preview.vercel.app" });
      expect(requestUrl?.searchParams.get("teamId")).toBe("team_xyz");
    });

    it("refuses a malformed alias before issuing any request", async () => {
      await expect(
        assignDeploymentAlias({
          token: "vercel-token",
          orgId: "team_xyz",
          deploymentId: "dpl_ready",
          alias: "https://loopworks-preview.vercel.app",
        }),
      ).rejects.toThrow(/hostname/i);
    });
  });

  describe("previewAliasComment", () => {
    it("links the alias and names the commit without exposing deployment internals", () => {
      const body = previewAliasComment({
        alias: "loopworks-preview.vercel.app",
        commitSha: headSha,
      });

      expect(body).toContain("https://loopworks-preview.vercel.app");
      expect(body).toContain(headSha.slice(0, 7));
      expect(body).toContain("Vercel Authentication");
    });
  });
});
