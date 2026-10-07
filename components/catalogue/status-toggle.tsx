"use client";

import { CircleCheck, CircleSlash, LoaderCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { setCategoryActive, setProductActive } from "@/lib/catalogue/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * Activate / Deactivate button. Deactivating asks for confirmation (it hides
 * the item from the storefront); activating is immediate. Nothing is deleted.
 */
export function StatusToggle({
  kind,
  id,
  name,
  active,
  size = "sm",
  compact = false,
}: {
  kind: "product" | "category";
  id: string;
  name: string;
  active: boolean;
  size?: "sm" | "md";
  /** Icon-only (tables, cards); the label stays available as tooltip + accessible name. */
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const copy = kind === "product" ? t.products : t.categories;
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply(nextActive: boolean) {
    startTransition(async () => {
      const action = kind === "product" ? setProductActive : setCategoryActive;
      const result = await action(id, nextActive);
      if (result.ok) {
        toast.success(nextActive ? copy.activated : copy.deactivated);
        setConfirming(false);
      } else {
        toast.error(t.errors[result.error]);
      }
    });
  }

  const label = active ? t.common.deactivate : t.common.activate;

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : size}
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
        title={format(copy.deactivateTitle, { name })}
        description={copy.deactivateBody}
        confirmLabel={t.common.deactivate}
        pending={pending}
        onConfirm={() => apply(false)}
      />
    </>
  );
}
