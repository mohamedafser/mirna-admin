"use client";

import { Check, LoaderCircle, Sparkles } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { generateVariants, type VariantError } from "@/lib/variants/actions";
import { combinations, MAX_VARIANTS_PER_CALL, type VariantAxis } from "@/lib/variants/rules";

/** Combinations listed at most (larger option sets are truncated, with a note). */
const DISPLAY_LIMIT = 1000;

/**
 * Shows every combination of the product's variant options, marks the ones
 * that already exist, and creates the selected new ones. Existing variants
 * are never modified ("regenerate" only ever adds). The product's stock is
 * the pool its variants share (migration 042): new variants start with 0,
 * and when a product with stock gets its first variants the admin may give
 * the whole pool to one of them; otherwise it's shared out later.
 */
export function VariantGenerator({
  productId,
  axes,
  existingKeys,
  stockToMove,
}: {
  productId: string;
  axes: VariantAxis[];
  existingKeys: string[];
  /** The product's stock pool (first variants only); 0 when none. */
  stockToMove: number;
}) {
  const { locale, messages } = useI18n();
  const t = messages.variants;
  const g = t.generator;
  const toast = useToast();
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<VariantError | null>(null);
  const [pending, startTransition] = useTransition();

  const all = useMemo(() => combinations(axes, DISPLAY_LIMIT + 1), [axes]);
  const shown = all.slice(0, DISPLAY_LIMIT);
  const existing = new Set(existingKeys);
  const fresh = shown.filter((combination) => !existing.has(combination.key));
  const total = axes.reduce((product, axis) => product * axis.values.length, 1);
  const chosen = shown.filter((combination) => selected.includes(combination.key));
  const needsTarget = stockToMove > 0 && chosen.length > 0;
  const number = (value: number) => value.toLocaleString(locale);

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
    if (target === key) setTarget("");
  }

  function submit() {
    if (pending || chosen.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await generateVariants(
          productId,
          chosen.map((combination) => combination.key),
          needsTarget ? target : null,
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success(format(g.created, { count: number(result.count) }));
        setSelected([]);
        setTarget("");
      } catch {
        setError("network");
      }
    });
  }

  const errorText = (code: VariantError) =>
    code in t.errors
      ? t.errors[code as keyof typeof t.errors]
      : messages.catalogue.errors[code as keyof typeof messages.catalogue.errors];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{g.hint}</p>

      {/* Options in use */}
      <dl className="grid gap-2 text-sm">
        {axes.map((axis) => (
          <div key={axis.attributeId} className="flex flex-wrap items-center gap-1.5">
            <dt className="me-1 font-medium">
              <bdi>{axis.name}</bdi>
            </dt>
            {axis.values.map((value) => (
              <dd key={value.id}>
                <span className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs">
                  {value.colorHex && (
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full border"
                      style={{ backgroundColor: value.colorHex }}
                    />
                  )}
                  <bdi>{value.value}</bdi>
                </span>
              </dd>
            ))}
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
        <span>{format(g.combinations, { count: number(total) })}</span>
        {existing.size > 0 && <span>{format(g.existing, { count: number(existing.size) })}</span>}
        {total > DISPLAY_LIMIT && (
          <span>{format(g.truncated, { count: number(DISPLAY_LIMIT) })}</span>
        )}
        <span className="ms-auto flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || fresh.length === 0}
            onClick={() =>
              setSelected(fresh.slice(0, MAX_VARIANTS_PER_CALL).map((item) => item.key))
            }
          >
            {g.selectNew}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending || selected.length === 0}
            onClick={() => {
              setSelected([]);
              setTarget("");
            }}
          >
            {g.clear}
          </Button>
        </span>
      </div>

      {fresh.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          {g.nothingNew}
        </p>
      ) : null}

      <ul
        aria-label={g.title}
        className="grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto overscroll-contain sm:grid-cols-2 xl:grid-cols-3"
      >
        {shown.map((combination) => {
          const exists = existing.has(combination.key);
          const checked = exists || selected.includes(combination.key);
          return (
            <li key={combination.key}>
              <label
                className={cn(
                  "flex h-10 items-center gap-2.5 rounded-md border px-3 text-sm transition-colors",
                  exists
                    ? "cursor-default bg-muted/40 text-muted-foreground"
                    : "cursor-pointer bg-card hover:border-input",
                  !exists && checked && "border-foreground bg-accent",
                  "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/15",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={exists || pending}
                  onChange={() => toggle(combination.key)}
                  className="size-4 accent-primary"
                />
                <bdi className="min-w-0 flex-1 truncate">{combination.label}</bdi>
                {exists ? (
                  <Badge className="py-0">
                    <Check aria-hidden />
                    {g.exists}
                  </Badge>
                ) : (
                  checked && (
                    <Badge tone="primary" className="py-0">
                      {g.new}
                    </Badge>
                  )
                )}
              </label>
            </li>
          );
        })}
      </ul>

      {needsTarget && (
        <Field
          id={`${id}-target`}
          label={g.stockTarget}
          hint={format(g.stockTargetHint, { quantity: number(stockToMove) })}
          error={error === "stockTargetRequired" ? errorText(error) : undefined}
        >
          {(a11y) => (
            <Combobox
              {...a11y}
              value={target}
              placeholder={g.stockTargetPlaceholder}
              disabled={pending}
              onChange={(key) => {
                setTarget(key);
                setError(null);
              }}
              options={[
                { value: "", label: g.stockTargetNone },
                ...chosen.map((combination) => ({
                  value: combination.key,
                  label: combination.label,
                })),
              ]}
              className="sm:max-w-sm"
            />
          )}
        </Field>
      )}

      {error && error !== "stockTargetRequired" && !pending && <Alert>{errorText(error)}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-xs text-muted-foreground">{g.pricesHint}</p>
        <Button disabled={pending || chosen.length === 0} aria-busy={pending} onClick={submit}>
          {pending ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : (
            <Sparkles aria-hidden />
          )}
          {pending ? g.creating : format(g.create, { count: number(chosen.length) })}
        </Button>
      </div>
    </div>
  );
}
