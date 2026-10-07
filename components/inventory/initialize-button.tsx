"use client";

import { LoaderCircle, PackagePlus } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { initializeInventory } from "@/lib/inventory/actions";
import { useI18n } from "@/lib/i18n/client";

/**
 * Explicitly creates missing inventory records (one product, or all missing
 * when productId is omitted). Lists never create records as a side effect.
 */
export function InitializeButton({
  productId,
  label,
  size = "sm",
}: {
  productId?: string;
  label: string;
  size?: "sm" | "md";
}) {
  const { messages } = useI18n();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size={size}
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            const result = await initializeInventory(productId);
            if (result.ok) toast.success(messages.inventory.initialized);
            else toast.error(messages.inventory.errors[result.error]);
          } catch {
            toast.error(messages.inventory.errors.network);
          }
        })
      }
    >
      {pending ? (
        <LoaderCircle aria-hidden className="animate-spin" />
      ) : (
        <PackagePlus aria-hidden />
      )}
      {label}
    </Button>
  );
}
