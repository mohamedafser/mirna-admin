"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deleteAttribute, deleteProductType } from "@/lib/attributes/actions";
import { deleteVariant } from "@/lib/variants/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * Permanently deletes an unused product type, attribute or variant, after
 * confirmation. In-use rows can't be deleted (the button is disabled, and the
 * database refuses it anyway): they are deactivated instead.
 */
export function DeleteButton({
  kind,
  id,
  name,
  inUse,
  compact = false,
  redirectTo,
}: {
  kind: "productType" | "attribute" | "variant";
  id: string;
  name: string;
  inUse: boolean;
  compact?: boolean;
  /** Where to go after deleting (detail pages); lists just refresh. */
  redirectTo?: string;
}) {
  const { messages } = useI18n();
  const a = messages.attributes;
  const copy = { productType: a.types, attribute: a.attrs, variant: messages.variants }[kind];
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply() {
    startTransition(async () => {
      if (kind === "variant") {
        const result = await deleteVariant(id);
        if (!result.ok) {
          const error = result.error;
          toast.error(
            error in messages.variants.errors
              ? messages.variants.errors[error as keyof typeof messages.variants.errors]
              : messages.catalogue.errors[error as keyof typeof messages.catalogue.errors],
          );
          return;
        }
      } else {
        const result = await (kind === "productType" ? deleteProductType : deleteAttribute)(id);
        if (!result.ok) {
          toast.error(
            result.error === "inUse" ? a.errors.inUse : messages.catalogue.errors[result.error],
          );
          return;
        }
      }
      setConfirming(false);
      toast.success(copy.deleted);
      if (redirectTo) router.push(redirectTo);
    });
  }

  const unavailable =
    kind === "variant" ? messages.variants.deleteUnavailable : a.deleteUnavailable;
  const label = inUse ? `${a.delete}: ${unavailable}` : `${a.delete}: ${name}`;

  return (
    <>
      <Button
        variant="outline"
        size={compact ? "icon-sm" : "sm"}
        disabled={pending || inUse}
        aria-busy={pending}
        aria-label={label}
        title={inUse ? unavailable : compact ? a.delete : undefined}
        onClick={() => setConfirming(true)}
      >
        {pending && !confirming ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : (
          <Trash2 aria-hidden />
        )}
        {!compact && <span aria-hidden>{a.delete}</span>}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={format(copy.deleteTitle, { name })}
        description={copy.deleteBody}
        confirmLabel={a.delete}
        pending={pending}
        onConfirm={apply}
      />
    </>
  );
}
