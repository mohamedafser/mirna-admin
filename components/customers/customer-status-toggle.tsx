"use client";

import { CircleCheck, CircleSlash, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { setCustomerActive } from "@/lib/customers/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * Activate / Deactivate a customer account. Deactivating asks for
 * confirmation (the customer can no longer place orders); activating is
 * immediate. Nothing is deleted.
 */
export function CustomerStatusToggle({
  id,
  name,
  active,
  compact = false,
}: {
  id: string;
  name: string;
  active: boolean;
  /** Icon-only (tables); the label stays available as tooltip + accessible name. */
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.customers;
  const common = messages.catalogue.common;
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(nextActive: boolean) {
    startTransition(async () => {
      const result = await setCustomerActive(id, nextActive);
      if (result.ok) {
        toast.success(nextActive ? t.activated : t.deactivated);
        setConfirming(false);
      } else {
        toast.error(t.errors[result.error]);
      }
    });
  }

  const label = active ? common.deactivate : common.activate;

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "sm"}
        disabled={pending}
        aria-busy={pending}
        aria-label={`${label}: ${name}`}
        title={compact ? label : undefined}
        onClick={() => (active ? setConfirming(true) : apply(true))}
      >
        {pending && !confirming ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : active ? (
          <CircleSlash aria-hidden />
        ) : (
          <CircleCheck aria-hidden />
        )}
        {!compact && <span aria-hidden>{label}</span>}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={format(t.deactivateTitle, { name })}
        description={t.deactivateBody}
        confirmLabel={common.deactivate}
        pending={pending}
        onConfirm={() => apply(false)}
      />
    </>
  );
}
