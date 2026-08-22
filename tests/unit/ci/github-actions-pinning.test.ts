import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAlias, isScalar, parseDocument, visit } from "yaml";

const repositoryRoot = path.resolve(__dirname, "../../..");
const workflowsDirectory = path.join(repositoryRoot, ".github/workflows");

// #234 introduced this registry. Each action revision is resolved from its
// publisher's GitHub tag during the review that upgrades that revision. Keeping
// the revision and release together makes an action upgrade an explicit
// contract change rather than accepting any string that merely resembles a SHA.
const approvedActions = new Map([
  ["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", "v7.0.1"],
  ["actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", "v7.0.0"],
  ["actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", "v7.0.1"],
  ["actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "v6.1.0"],
  ["astral-sh/setup-uv@20cfd1bf945f4377ade1205e4dbc17946fc9a30d", "v10.0.1"],
  ["oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6", "v2.2.0"],
]);

type UsesNode = {
  comment: string | null;
  value: unknown;
};

function collectUses(source: string): UsesNode[] {
  const document = parseDocument(source);
  expect(document.errors, "workflow YAML must parse without errors").toEqual([]);
  const usesNodes: UsesNode[] = [];

  visit(document, {
    Pair(_key, pair) {
      const resolvedKey = isAlias(pair.key) ? pair.key.resolve(document) : pair.key;
      if (!isScalar(resolvedKey) || resolvedKey.value !== "uses") return;
      const resolvedValue = isAlias(pair.value) ? pair.value.resolve(document) : pair.value;
      const comment =
        isScalar(pair.value) || isAlias(pair.value) ? (pair.value.comment?.trim() ?? null) : null;
      usesNodes.push({
        comment,
        value: isScalar(resolvedValue) ? resolvedValue.value : resolvedValue,
      });
    },
  });

  return usesNodes;
}

describe("GitHub Actions supply-chain pins", () => {
  it("discovers uses keys through YAML structure rather than textual spelling", () => {
    const source = `
jobs:
  test:
    steps:
      - uses : actions/checkout@v7
      - { uses: actions/cache@v6 }
`;

    expect(collectUses(source).map((node) => node.value)).toEqual([
      "actions/checkout@v7",
      "actions/cache@v6",
    ]);
  });

  it("discovers uses keys and values expressed through YAML aliases", () => {
    const source = `
name: &actionKey uses
run: &actionValue actions/checkout@v7
jobs:
  test:
    steps:
      - *actionKey : *actionValue
`;

    expect(collectUses(source).map((node) => node.value)).toEqual(["actions/checkout@v7"]);
  });

  it("keeps each release comment bound to its own uses node", () => {
    const source = `
steps:
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # mislabeled
`;

    expect(collectUses(source).map((node) => node.comment)).toEqual(["v7.0.1", "mislabeled"]);
  });

  it("retains malformed uses values so the contract rejects them", () => {
    expect(collectUses("jobs: { invalid: { uses: 123 } }")).toEqual([
      { comment: null, value: 123 },
    ]);
  });

  it("pins every workflow action to a full commit SHA with a readable version", () => {
    const workflowPaths = readdirSync(workflowsDirectory)
      .filter((name) => /\.ya?ml$/.test(name))
      .map((name) => path.join(workflowsDirectory, name));

    expect(workflowPaths.length).toBeGreaterThan(0);

    for (const workflowPath of workflowPaths) {
      const source = readFileSync(workflowPath, "utf8");
      const usesNodes = collectUses(source);

      for (const usesNode of usesNodes) {
        expect(
          typeof usesNode.value,
          `${path.basename(workflowPath)} has a non-string uses value`,
        ).toBe("string");
        const uses = String(usesNode.value);
        const version = approvedActions.get(uses);
        expect(
          version,
          `${path.basename(workflowPath)} uses an unreviewed action revision: ${uses}`,
        ).toBeDefined();
        expect(usesNode.comment, `${path.basename(workflowPath)} mislabels ${uses}`).toBe(version);
      }
    }
  });
});
