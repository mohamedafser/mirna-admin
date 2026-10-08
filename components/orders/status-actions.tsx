"use client";

import { CircleSlash, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { updateOrderStatus } from "@/lib/orders/actions";
import { nextStatuses } from "@/lib/orders/rules";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import type { OrderStatus } from "@/types/domain";

/**
 * The allowed next steps for an order: a primary button for the forward
 * move and "Cancel order" (confirmed in a dialog) where allowed. Final
 * statuses show a note instead. The server and database re-check every move.
 */
export function StatusActions({
  orderId,
  orderNumber,
  status,
}: {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
}) {
  const { messages } = useI18n();
  const t = messages.orders;
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const next = nextStatuses(status);
  const forward = next.filter((s) => s !== "CANCELLED");
  const canCancel = next.includes("CANCELLED");

  function apply(to: OrderStatus) {
    setTarget(to);
    startTransition(async () => {
      const result = await updateOrderStatus(orderId, status, to).catch(
        () => ({ ok: false, error: "network" }) as const,
      );
      if (result.ok) {
        toast.success(format(t.detail.updated, { number: orderNumber, status: t.status[to] }));
        setConfirmCancel(false);
      } else {
        toast.error(t.errors[result.error]);
        // Someone else moved it: show the current status.
        if (result.error === "conflict" || result.error === "invalidTransition") router.refresh();
      }
      setTarget(null);
    });
  }

  if (next.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {format(t.detail.finalStatus, { status: t.status[status] })}
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {forward.map((to) => (
        <Button
          key={to}
          disabled={pending}
          aria-busy={pending && target === to}
          onClick={() => apply(to)}
        >
          {pending && target === to && <LoaderCircle aria-hidden className="animate-spin" />}
          {format(t.detail.markAs, { status: t.status[to] })}
        </Button>
      ))}
      {canCancel && (
        <Button variant="outline" disabled={pending} onClick={() => setConfirmCancel(true)}>
          <CircleSlash aria-hidden />
          {t.detail.cancel}
        </Button>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={format(t.detail.cancelTitle, { number: orderNumber })}
        description={t.detail.cancelBody}
        confirmLabel={t.detail.cancel}
        cancelLabel={t.detail.keep}
        pending={pending}
        onConfirm={() => apply("CANCELLED")}
      />
    </div>
  );
}
