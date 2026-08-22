import { parseAliasHost } from "./vercel-preview-alias";

export async function verifyPreviewAlias(input: {
  alias: string;
  fetchFn?: typeof fetch;
}): Promise<void> {
  const alias = parseAliasHost(input.alias);
  const response = await (input.fetchFn ?? fetch)(`https://${alias}/`, { redirect: "manual" });

  // Deployment Protection redirects to Vercel sign-in. A successful redirect
  // still proves that the assigned stable hostname resolves; browser journeys
  // remain separately authenticated and are never implied by this check.
  if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
    throw new Error(`Preview alias / responded ${response.status}.`);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const aliasFlag = argv.indexOf("--alias");
  const alias = aliasFlag === -1 ? undefined : argv[aliasFlag + 1];
  if (!alias) throw new Error("--alias is required.");

  await verifyPreviewAlias({ alias });
  console.log(`Preview alias https://${parseAliasHost(alias)} is reachable.`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
