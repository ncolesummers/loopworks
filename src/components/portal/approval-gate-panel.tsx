"use client";

import { useState } from "react";
import { ShieldCheck, Sparkles } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getApprovalChecklistStatus, getApprovalStatus } from "@/components/portal/status-mapping";
import type { ApprovalGateRecord } from "@/lib/types";

export function ApprovalGatePanel({ approval }: Readonly<{ approval: ApprovalGateRecord }>) {
  const [open, setOpen] = useState(false);
  const approvalStatus = getApprovalStatus(approval.state);

  return (
    <Card className="shadow-none">
      <CardHeader className="flex-row items-end justify-between gap-4">
        <div className="space-y-1">
          <CardTitle>Approval gate</CardTitle>
          <CardDescription>
            Security signoff is required before high-risk automation or write paths advance.
          </CardDescription>
        </div>
        <StatusBadge status={approvalStatus.status} label={approvalStatus.label} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3 rounded-md border p-4">
            {approval.checklist.map((item) => {
              const itemStatus = getApprovalChecklistStatus(item.done);

              return (
                <div key={item.label} className="flex items-start gap-3">
                  <StatusBadge status={itemStatus.status} label={itemStatus.label} dotOnly />
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.done
                        ? "Verified against the fixture state."
                        : "Needs explicit maintainer review."}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div className="text-sm font-medium">Review details</div>
            <div className="text-sm text-muted-foreground">Owner {approval.owner}</div>
            <div className="text-sm text-muted-foreground">Due {approval.due}</div>
            <div className="text-sm text-muted-foreground">{approval.risk}</div>

            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="w-full gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Request approval
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request security approval</DialogTitle>
                  <DialogDescription>
                    Confirm that the current portal snapshot is safe to advance. The request records
                    the same evidence that appears on the screen.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="requester">Requester</Label>
                    <Input id="requester" defaultValue="Colesummers" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="notes">Reviewer notes</Label>
                    <Textarea
                      id="notes"
                      defaultValue="Verified GitHub scoping, preview visibility, and redaction rules against the local fixture."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setOpen(false)} className="gap-2">
                    <Sparkles className="h-4 w-4" />
                    Submit request
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
