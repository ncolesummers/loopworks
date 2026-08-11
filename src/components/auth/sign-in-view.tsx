import { GitHubMark } from "@/components/auth/github-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SignInErrorNotice } from "@/lib/auth/sign-in-errors";

/**
 * The unauthenticated entry surface (#214, ADR 0028).
 *
 * Presentational only, and deliberately so: it must not import `@/auth` or the sign-in server
 * action, directly or transitively, or Storybook's build pulls `next-auth`, the Drizzle adapter,
 * and the Postgres client into a browser bundle and the config registry evaluates at module
 * scope. The action arrives as a prop instead, which is also what lets the stories render every
 * failure state without a server.
 *
 * The activation steps mirror ADR 0019's onboarding stages in order. They stop at a registered
 * loop, because that is where activation ends - producing a first run depends on a trigger.
 *
 * Headings are raw `h1`/`h2` rather than `CardTitle`, which hardcodes an `h3` and would leave a
 * heading-order gap the portal currently bridges with an sr-only heading.
 */
export function SignInView({
  action,
  callbackUrl,
  notice,
}: Readonly<{
  action: (formData: FormData) => void | Promise<void>;
  /** Already reduced to a same-origin path by `resolveSignInRedirect`. */
  callbackUrl: string;
  notice?: SignInErrorNotice;
}>) {
  return (
    <section aria-labelledby="sign-in-title" className="w-full max-w-[560px]">
      <Card className="shadow-none">
        <CardHeader className="gap-2">
          <h1 className="text-2xl font-semibold tracking-tight" id="sign-in-title">
            Sign in to Loopworks
          </h1>
          <p className="text-sm text-muted-foreground">
            Loopworks is an agentic software factory portal: it plans, runs, validates, and improves
            software delivery loops against your GitHub repositories.
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          {/*
            The slot is present whether or not there is a notice, so reaching a failure state
            does not shift the rest of the card down the page.
          */}
          <div className="min-h-[12rem]" data-sign-in-notice>
            <div aria-live="polite" role="status">
              {notice ? <SignInNotice notice={notice} /> : null}
            </div>
          </div>

          <section aria-labelledby="sign-in-why">
            <h2 className="text-sm font-medium" id="sign-in-why">
              Why Loopworks uses GitHub
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              GitHub holds the work itself — issues, plans, pull requests, and delivery state.
              Loopworks reads that state and writes durable summaries back, so your GitHub account
              is the identity it runs and audits every loop under.
            </p>
          </section>

          <section aria-labelledby="sign-in-access" className="flex flex-col items-start gap-2">
            <h2 className="text-sm font-medium" id="sign-in-access">
              Who can sign in
            </h2>
            <p className="text-sm text-muted-foreground">
              Access is limited to GitHub accounts an operator has already approved for this
              workspace. Signing in does not create an account or ask for one.
            </p>
            <StatusBadge label="Approved accounts only" status="needsApproval" />
          </section>

          <section aria-labelledby="sign-in-next">
            <h2 className="text-sm font-medium" id="sign-in-next">
              What happens after you sign in
            </h2>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>Install the GitHub App on the account or organization you deliver from.</li>
              <li>Select repositories for Loopworks to track.</li>
              <li>Register your first loop against one of them.</li>
            </ol>
          </section>
        </CardContent>

        <CardFooter>
          <form action={action} className="w-full">
            <input name="callbackUrl" type="hidden" value={callbackUrl} />
            {/*
              `type="submit"` is required: `Button` defaults to `type="button"`, which renders a
              control that looks right and silently never submits.
            */}
            <Button className="w-full" size="lg" type="submit">
              <GitHubMark className="h-4 w-4" />
              Continue with GitHub
            </Button>
          </form>
        </CardFooter>
      </Card>
    </section>
  );
}

function SignInNotice({ notice }: Readonly<{ notice: SignInErrorNotice }>) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-foreground">{notice.title}</p>
        <StatusBadge status={notice.status} />
      </div>
      <p className="text-sm text-muted-foreground">{notice.detail}</p>
      <p className="text-sm text-muted-foreground">{notice.nextStep}</p>
    </div>
  );
}
