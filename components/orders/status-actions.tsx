"use client";

import { CircleSlash, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { cancelAndRefundOrder, updateOrderStatus } from "@/lib/orders/actions";
import { nextStatuses } from "@/lib/orders/rules";
import { isCaptured, isOpen, type PaymentStatus } from "@/lib/payments/rules";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";
import type { OrderStatus } from "@/types/domain";

/**
 * The allowed next steps for an order: a primary button for the forward
 * move and "Cancel order" (confirmed in a dialog) where allowed. Final
 * statuses show a note instead. The server and database re-check every move.
 * Orders paid online wait for their payment before moving forward, and a
 * paid order is refunded (Payment panel) rather than cancelled.
 */
export function StatusActions({
  orderId,
  orderNumber,
  status,
  paymentStatus,
}: {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
  /** Online payment (migration 044); null: not paid online. */
  paymentStatus: PaymentStatus | null;
}) {
  const { messages } = useI18n();
  const t = messages.orders;
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<OrderStatus | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRefund, setConfirmRefund] = useState(false);

  const next = nextStatuses(status, paymentStatus);
  const awaitingPayment = status === "PENDING" && isOpen(paymentStatus);
  // Cancelling would be allowed if it weren't paid.
  const paidNoCancel = isCaptured(paymentStatus) && nextStatuses(status).includes("CANCELLED");
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
        if (
          result.error === "conflict" ||
          result.error === "invalidTransition" ||
          result.error === "paymentRequired" ||
          result.error === "paymentCaptured"
        ) {
          router.refresh();
        }
      }
      setTarget(null);
    });
  }

  // Paid online: cancelling refunds the payment through Stripe.
  function cancelAndRefund() {
    setTarget("REFUNDED");
    startTransition(async () => {
      const result = await cancelAndRefundOrder(orderId, status).catch(
        () => ({ ok: false, error: "network" }) as const,
      );
      if (result.ok) {
        toast.success(format(t.detail.cancelRefundDone, { number: orderNumber }));
        setConfirmRefund(false);
      } else {
        toast.error(t.errors[result.error]);
        if (result.error === "conflict" || result.error === "invalidTransition") router.refresh();
      }
      setTarget(null);
    });
  }

  if (
    next.length === 0 &&
    status !== "DELIVERED" &&
    status !== "CANCELLED" &&
    status !== "REFUNDED"
  ) {
    // Not final: waiting on the payment.
    return (
      <p className="text-sm text-muted-foreground">
        {awaitingPayment ? t.detail.awaitingPayment : t.detail.paidCancelNote}
      </p>
    );
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
      {awaitingPayment && (
        <p className="text-xs text-muted-foreground">{t.detail.awaitingPayment}</p>
      )}
      {paidNoCancel && (
        <Button
          variant="outline"
          disabled={pending}
          aria-busy={pending && target === "REFUNDED"}
          onClick={() => setConfirmRefund(true)}
        >
          {pending && target === "REFUNDED" ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <CircleSlash aria-hidden />
          )}
          {t.detail.cancelRefund}
        </Button>
      )}
      <ConfirmDialog
        open={confirmRefund}
        onOpenChange={setConfirmRefund}
        title={format(t.detail.cancelRefundTitle, { number: orderNumber })}
        description={t.detail.cancelRefundBody}
        confirmLabel={t.detail.cancelRefund}
        cancelLabel={t.detail.keep}
        pending={pending}
        onConfirm={cancelAndRefund}
      />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={format(t.detail.cancelTitle, { number: orderNumber })}
        description={isOpen(paymentStatus) ? t.detail.cancelBodyOnline : t.detail.cancelBody}
        confirmLabel={t.detail.cancel}
        cancelLabel={t.detail.keep}
        pending={pending}
        onConfirm={() => apply("CANCELLED")}
      />
    </div>
  );
}
