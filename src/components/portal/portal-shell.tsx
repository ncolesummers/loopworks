"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Circle,
  Database,
  GitBranch,
  Github,
  Layers3,
  ShieldCheck,
  SquareTerminal,
  Workflow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Dashboard", icon: SquareTerminal },
  { href: "/catalog", label: "Catalog", icon: Database },
  { href: "/loops", label: "Loops", icon: Workflow },
  { href: "/runs", label: "Runs", icon: Clock3 },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/deployments", label: "Deployments", icon: GitBranch },
  { href: "/settings", label: "Settings", icon: Github },
] as const;

export function PortalShell({
  children,
  user,
}: Readonly<{
  children: ReactNode;
  user: {
    name: string;
    githubLogin: string;
    mode: "github" | "fixture";
  };
}>) {
  const pathname = usePathname();
  const initials = user.githubLogin.slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-r bg-card/80 px-4 py-5 backdrop-blur">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-background shadow-sm">
              <Layers3 className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight">Loopworks</div>
              <div className="text-xs text-muted-foreground">Agentic software factory portal</div>
            </div>
          </div>

          <Separator className="my-5" />

          <nav aria-label="Primary" className="space-y-1">
            {navigation.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              const content = (
                <>
                  <Icon className="h-4 w-4" />
                  <span className="flex-1">{item.label}</span>
                  {active ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : (
                    <Circle className="h-3 w-3 text-muted-foreground" />
                  )}
                </>
              );

              return (
                <Link
                  key={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    active && "bg-accent text-accent-foreground",
                  )}
                  href={item.href}
                >
                  {content}
                </Link>
              );
            })}
          </nav>

          <Separator className="my-5" />

          <div className="space-y-3 px-2">
            <StatusBadge
              status="ready"
              label={user.mode === "github" ? "Authenticated session" : "Fixture session"}
            />
            <div className="text-xs leading-5 text-muted-foreground">
              {user.mode === "github"
                ? "GitHub SSO is active for this workspace. GitHub and Vercel data are rendered as operational snapshots."
                : "Local fixture mode is enabled for this workspace. GitHub and Vercel data are rendered as operational snapshots."}
            </div>
            <Button variant="outline" className="w-full justify-between" asChild>
              <Link href="/catalog">
                <span>Open repo catalog</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
            <div className="flex items-center justify-between gap-4 px-5 py-4 lg:px-8">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Operator workspace
                </div>
                <div className="truncate text-lg font-semibold">
                  Repo intake, loop control, previews, and review gates
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="hidden h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium md:inline-flex">
                  <Database className="h-3.5 w-3.5" />
                  Postgres sync
                </span>
                <span className="hidden h-6 items-center gap-1.5 rounded-md border bg-background px-2 text-xs font-medium md:inline-flex">
                  <Github className="h-3.5 w-3.5" />
                  GitHub SSO
                </span>
                <ModeToggle />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="min-w-0 gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {initials}
                      </span>
                      <span className="max-w-28 truncate sm:max-w-40">{user.name}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Session</DropdownMenuLabel>
                    <DropdownMenuItem>Workspace: loopworks</DropdownMenuItem>
                    <DropdownMenuItem>GitHub: {user.githubLogin}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Audit log</DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href="/api/auth/signout">Sign out</a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
