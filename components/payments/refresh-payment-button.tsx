"use client";

import { LoaderCircle, RotateCw } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { refreshPayment, type PaymentActionResult } from "@/lib/payments/actions";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";

/** Re-reads one payment from Stripe (normally webhooks keep it current). */
export function RefreshPaymentButton({ paymentId }: { paymentId: string }) {
  const { messages } = useI18n();
  const t = messages.orders.payment;
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await refreshPayment(paymentId).catch((): PaymentActionResult => ({
            ok: false,
            error: "unexpected",
          }));
          if (result.ok) toast.success(t.refreshed);
          else toast.error(format(t.errors[result.error], { detail: result.detail ?? "" }));
        })
      }
    >
      {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <RotateCw aria-hidden />}
      {t.refresh}
    </Button>
  );
}
