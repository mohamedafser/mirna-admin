"use client";

import { LoaderCircle } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { updateLowStockThreshold } from "@/lib/inventory/actions";
import { parseThreshold, type ThresholdError } from "@/lib/inventory/rules";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/** Low-stock threshold editor (whole number >= 0), saved on its own. */
export function ThresholdForm({
  productId,
  threshold,
  compact = false,
}: {
  productId: string;
  threshold: number;
  /** Hide the hint visually (kept for screen readers and as a tooltip). */
  compact?: boolean;
}) {
  const { messages } = useI18n();
  const t = messages.inventory;
  const toast = useToast();
  const [value, setValue] = useState(String(threshold));
  const [error, setError] = useState<ThresholdError | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  return (
    <form
      noValidate
      className="grid gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseThreshold(value);
        if (!parsed.ok) return setError(parsed.error);
        setError(null);
        startTransition(async () => {
          try {
            const result = await updateLowStockThreshold(productId, value);
            if (result.ok) toast.success(t.threshold.saved);
            else if (result.error === "thresholdInvalid" || result.error === "thresholdRequired") {
              setError(result.error);
            } else toast.error(t.errors[result.error]);
          } catch {
            toast.error(t.errors.network);
          }
        });
      }}
    >
      <Label htmlFor={id} className="text-xs" title={compact ? t.threshold.hint : undefined}>
        {t.threshold.label}
      </Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          inputMode="numeric"
          dir="ltr"
          disabled={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-desc`}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="h-11 shrink-0"
          disabled={pending || value.trim() === String(threshold)}
        >
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {t.threshold.save}
        </Button>
      </div>
      <p
        id={`${id}-desc`}
        className={
          error ? "text-xs text-error" : cn("text-xs text-muted-foreground", compact && "sr-only")
        }
      >
        {error ? t.errors[error] : t.threshold.hint}
      </p>
    </form>
  );
}
