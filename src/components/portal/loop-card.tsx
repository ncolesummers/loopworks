"use client";

import { useId } from "react";

import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import {
  getLoopEnabledStatus,
  getLoopRiskStatus,
  getLoopStateStatus,
} from "@/components/portal/status-mapping";
import type { LoopRegistryItem } from "@/lib/types";

export function LoopCard({
  loop,
  disabled = false,
  onEnabledChange,
}: Readonly<{
  loop: LoopRegistryItem;
  disabled?: boolean;
  onEnabledChange?: (checked: boolean) => void;
}>) {
  const generatedId = useId();
  const switchId = `loop-${generatedId}`;
  const enabled = getLoopEnabledStatus(loop.enabled);
  const state = getLoopStateStatus(loop.state);
  const risk = getLoopRiskStatus(loop.risk);

  return (
    <div className="flex items-center gap-4 rounded-md border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="font-medium">{loop.name}</div>
          <StatusBadge status={enabled.status} label={enabled.label} />
          <StatusBadge status={state.status} label={state.label} />
          <StatusBadge status={risk.status} label={risk.label} />
        </div>
        <div className="mt-1 text-sm text-muted-foreground">
          Owner {loop.owner} / queue depth {loop.queueDepth}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor={switchId} className="sr-only">
          {loop.name}
        </Label>
        <Switch
          id={switchId}
          checked={loop.enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
    </div>
  );
}
