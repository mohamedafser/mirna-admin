"use client";

import { LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deleteShippingCountry } from "@/lib/shipping/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";

/**
 * Deletes a country's shipping configuration after confirmation. Once an
 * order used it, it can only be disabled (the button is disabled, and the
 * database refuses it anyway).
 */
export function DeleteCountryButton({
  countryCode,
  name,
  inUse,
}: {
  countryCode: string;
  name: string;
  inUse: boolean;
}) {
  const { locale, messages } = useI18n();
  const t = messages.shipping;
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function apply() {
    startTransition(async () => {
      const result = await deleteShippingCountry(countryCode);
      if (!result.ok) {
        toast.error(t.errors[result.error]);
        setConfirming(false);
        return;
      }
      toast.success(format(t.detail.deleted, { country: name }));
      router.push(`/${locale}/admin/shipping`);
    });
  }

  const label = format(t.detail.deleteNamed, { country: name });
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={pending || inUse}
        aria-label={label}
        title={inUse ? t.detail.deleteInUse : label}
        onClick={() => setConfirming(true)}
      >
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Trash2 aria-hidden />}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={format(t.detail.deleteTitle, { country: name })}
        description={t.detail.deleteBody}
        confirmLabel={t.detail.delete}
        pending={pending}
        onConfirm={apply}
      />
    </>
  );
}
