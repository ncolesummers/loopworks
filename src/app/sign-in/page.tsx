import { Layers3 } from "lucide-react";
import type { Metadata } from "next";

import { SignInView } from "@/components/auth/sign-in-view";
import { ModeToggle } from "@/components/mode-toggle";
import { startGithubSignIn } from "@/lib/auth/sign-in-action";
import { resolveSignInError } from "@/lib/auth/sign-in-errors";
import { resolveSignInRedirect } from "@/lib/auth/sign-in-redirect";

export const metadata: Metadata = {
  title: "Sign in to Loopworks",
  description:
    "Sign in with an approved GitHub account to reach the Loopworks delivery-loop portal.",
};

/**
 * The unauthenticated entry surface (#214).
 *
 * The page owns the landmarks and the session-free chrome; `SignInView` owns the card. That
 * split keeps the view free of `next-themes` and Auth.js so Storybook can render every state.
 *
 * There is deliberately no redirect for an operator who already has a session. A session can
 * exist and still fail the allowlist, and `auth()` returning one says nothing about
 * authorization - so redirecting on its presence would bounce that operator between here and
 * the guard forever.
 */
export default async function SignInPage({
  searchParams,
}: Readonly<{
  searchParams?: Promise<{ callbackUrl?: string | string[]; error?: string | string[] }>;
}>) {
  const params = await searchParams;
  const callbackUrl = resolveSignInRedirect(
    typeof params?.callbackUrl === "string" ? params.callbackUrl : undefined,
  );
  const notice = resolveSignInError(params?.error);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background shadow-sm">
            <Layers3 aria-hidden="true" className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">Loopworks</div>
            <div className="text-xs text-muted-foreground">Agentic software factory portal</div>
          </div>
        </div>
        <ModeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <SignInView action={startGithubSignIn} callbackUrl={callbackUrl} notice={notice} />
      </main>

      <footer className="border-t px-4 py-4 text-xs text-muted-foreground sm:px-6">
        Loopworks does not create accounts at sign-in.
      </footer>
    </div>
  );
}
