import type * as React from "react";
import { cva } from "class-variance-authority";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Eye,
  Loader2,
  MinusCircle,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type Status =
  | "loading"
  | "empty"
  | "disabled"
  | "pending"
  | "queued"
  | "running"
  | "blocked"
  | "failed"
  | "succeeded"
  | "skipped"
  | "needsApproval"
  | "approved"
  | "rejected"
  | "done"
  | "production"
  | "preview"
  | "ready"
  | "building"
  | "errored"
  | "canceled";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const STATUS_META: Record<
  Status,
  { label: string; tone: Tone; icon: LucideIcon; spin?: boolean }
> = {
  loading: { label: "Loading", tone: "info", icon: Loader2, spin: true },
  empty: { label: "Empty", tone: "neutral", icon: CircleDashed },
  disabled: { label: "Disabled", tone: "neutral", icon: Ban },
  pending: { label: "Pending", tone: "neutral", icon: Clock },
  queued: { label: "Queued", tone: "neutral", icon: Clock },
  running: { label: "Running", tone: "info", icon: Loader2, spin: true },
  blocked: { label: "Blocked", tone: "warning", icon: AlertTriangle },
  failed: { label: "Failed", tone: "danger", icon: XCircle },
  succeeded: { label: "Succeeded", tone: "success", icon: CheckCircle2 },
  skipped: { label: "Skipped", tone: "neutral", icon: MinusCircle },
  needsApproval: { label: "Needs Approval", tone: "warning", icon: ShieldAlert },
  approved: { label: "Approved", tone: "success", icon: ShieldCheck },
  rejected: { label: "Rejected", tone: "danger", icon: XCircle },
  done: { label: "Done", tone: "success", icon: CheckCircle2 },
  production: { label: "Production", tone: "success", icon: Rocket },
  preview: { label: "Preview", tone: "info", icon: Eye },
  ready: { label: "Ready", tone: "success", icon: CheckCircle2 },
  building: { label: "Building", tone: "info", icon: Loader2, spin: true },
  errored: { label: "Errored", tone: "danger", icon: AlertCircle },
  canceled: { label: "Canceled", tone: "neutral", icon: Ban },
};

const badgeToneVariants = cva(
  "inline-flex items-center gap-1.5 h-6 rounded-md border px-2 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        success: "border-success-border bg-success-muted text-success-foreground",
        warning: "border-warning-border bg-warning-muted text-warning-foreground",
        danger: "border-danger-border bg-danger-muted text-danger-foreground",
        info: "border-info-border bg-info-muted text-info-foreground",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

const iconToneVariants = cva("h-3.5 w-3.5 shrink-0", {
  variants: {
    tone: {
      success: "text-success",
      warning: "text-warning",
      danger: "text-danger",
      info: "text-info",
      neutral: "text-muted-foreground",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

const dotToneVariants = cva("h-2 w-2 rounded-full", {
  variants: {
    tone: {
      success: "bg-success",
      warning: "bg-warning",
      danger: "bg-danger",
      info: "bg-info",
      neutral: "bg-muted-foreground",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: Status;
  label?: string;
  showIcon?: boolean;
  dotOnly?: boolean;
  pulse?: boolean;
}

export function StatusBadge({
  status,
  label,
  showIcon = true,
  dotOnly = false,
  pulse,
  className,
  ...props
}: StatusBadgeProps) {
  const meta = STATUS_META[status];
  const displayLabel = label ?? meta.label;
  const tone = meta.tone;
  const shouldAnimate = pulse ?? meta.spin ?? false;

  if (dotOnly) {
    return (
      <span className={cn("inline-flex items-center", className)} {...props}>
        <span
          className={cn(
            dotToneVariants({ tone }),
            shouldAnimate && "animate-pulse motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
        <span className="sr-only">{displayLabel}</span>
      </span>
    );
  }

  const Icon = meta.icon;

  return (
    <span className={cn(badgeToneVariants({ tone }), className)} {...props}>
      {showIcon && (
        <Icon
          className={cn(
            iconToneVariants({ tone }),
            shouldAnimate && "animate-spin motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
      )}
      {displayLabel}
    </span>
  );
}
