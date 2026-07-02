import { FixtureGatedPage } from "@/components/portal/fixture-gated-page";
import { RepoCatalog } from "@/components/portal/repo-catalog";
import { portalFixture } from "@/lib/fixtures";

export default function CatalogPage() {
  return (
    <FixtureGatedPage area="Catalog">
      <div className="space-y-6">
        <h1 className="sr-only">Catalog</h1>
        <h2 className="sr-only">Catalog summary</h2>
        <RepoCatalog repos={portalFixture.repos} />
      </div>
    </FixtureGatedPage>
  );
}
