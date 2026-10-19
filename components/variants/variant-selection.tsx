"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, Trash2, X } from "lucide-react";
import { createContext, use, useMemo, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { deleteVariants } from "@/lib/variants/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/** A deletable variant on this page. */
export interface SelectableVariant {
  id: string;
  /** Units on hand (cleared to 0 before deleting). */
  quantity: number;
  /** No longer matches the product's current options. */
  outdated: boolean;
}

interface Selection {
  /** Deletable variants on this page (what "select all" selects). */
  ids: string[];
  /** Units on hand per variant id. */
  stock: Map<string, number>;
  outdated: string[];
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  selectOutdated: () => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = use(SelectionContext);
  if (!value) throw new Error("Variant selection components need <VariantSelection>.");
  return value;
}

/**
 * Checkbox selection for one page of a product's variants (table and cards
 * share it) plus the floating bulk-delete bar. The page passes `key` = its
 * query, so changing page or filters starts a fresh selection.
 */
export function VariantSelection({
  productId,
  variants,
  children,
}: {
  productId: string;
  variants: SelectableVariant[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const value = useMemo<Selection>(() => {
    const ids = variants.map((variant) => variant.id);
    const outdated = variants.filter((variant) => variant.outdated).map((variant) => variant.id);
    return {
      ids,
      stock: new Map(variants.map((variant) => [variant.id, variant.quantity])),
      outdated,
      selected,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
      selectOutdated: () => setSelected(new Set(outdated)),
      clear: () => setSelected(new Set()),
    };
  }, [variants, selected]);
  return (
    <SelectionContext value={value}>
      {children}
      <BulkBar productId={productId} />
    </SelectionContext>
  );
}

const boxClassName =
  "size-4 shrink-0 cursor-pointer rounded accent-primary disabled:cursor-not-allowed disabled:opacity-40";

/** One variant's checkbox; disabled (with a hint) when it can't be deleted. */
export function SelectVariant({
  id,
  name,
  disabled = false,
  className,
}: {
  id: string;
  name: string;
  disabled?: boolean;
  className?: string;
}) {
  const { messages } = useI18n();
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={!disabled && selected.has(id)}
      disabled={disabled}
      onChange={() => toggle(id)}
      aria-label={format(messages.variants.bulk.selectNamed, { name })}
      title={disabled ? messages.variants.deleteUnavailable : undefined}
      className={cn(boxClassName, className)}
    />
  );
}

/** "Select all deletable on this page" (checked / mixed / unchecked). */
export function SelectAllVariants({
  withLabel = false,
  className,
}: {
  withLabel?: boolean;
  className?: string;
}) {
  const { messages } = useI18n();
  const t = messages.variants.bulk;
  const { ids, selected, setAll } = useSelection();
  const count = ids.filter((id) => selected.has(id)).length;
  const all = count > 0 && count === ids.length;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        checked={all}
        disabled={ids.length === 0}
        ref={(node) => {
          if (node) node.indeterminate = count > 0 && !all;
        }}
        onChange={() => setAll(!all)}
        aria-label={withLabel ? undefined : t.selectAll}
        title={ids.length === 0 ? messages.variants.deleteUnavailable : undefined}
        className={boxClassName}
      />
      {withLabel && <span>{t.selectAll}</span>}
    </label>
  );
}

/** Selects the variants that no longer match the product's options. */
export function SelectOutdatedVariants() {
  const { messages } = useI18n();
  const { outdated, selectOutdated } = useSelection();
  if (outdated.length === 0) return null;
  return (
    <Button size="sm" variant="outline" onClick={selectOutdated}>
      {messages.variants.bulk.selectOutdated}
      <span className="tabular-nums text-muted-foreground">({outdated.length})</span>
    </Button>
  );
}

/** Floating bar with the bulk delete, shown while anything is selected. */
function BulkBar({ productId }: { productId: string }) {
  const { locale, messages } = useI18n();
  const t = messages.variants.bulk;
  const toast = useToast();
  const { selected, stock, clear } = useSelection();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const count = selected.size;
  const units = [...selected].reduce((sum, id) => sum + (stock.get(id) ?? 0), 0);

  function apply() {
    startTransition(async () => {
      const result = await deleteVariants(productId, [...selected]);
      if (!result.ok) {
        const error = result.error;
        toast.error(
          error in messages.variants.errors
            ? messages.variants.errors[error as keyof typeof messages.variants.errors]
            : messages.catalogue.errors[error as keyof typeof messages.catalogue.errors],
        );
        return;
      }
      if (result.deleted > 0) toast.success(format(t.deleted, { count: result.deleted }));
      if (result.skipped > 0) toast.error(format(t.skipped, { count: result.skipped }));
      setConfirming(false);
      clear();
    });
  }

  return (
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            role="region"
            aria-label={t.label}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md flex-wrap items-center gap-2 rounded-2xl border border-brand/30 bg-card/95 p-2 ps-4 shadow-elevated backdrop-blur"
          >
            <p className="me-auto text-sm font-medium tabular-nums" aria-live="polite">
              {format(t.selected, { count })}
            </p>
            <Button size="sm" disabled={pending} onClick={() => setConfirming(true)}>
              {pending ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <Trash2 aria-hidden />
              )}
              {messages.attributes.delete}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              aria-label={t.clear}
              title={t.clear}
              onClick={clear}
            >
              <X aria-hidden />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={format(t.deleteTitle, { count })}
        description={
          units > 0
            ? `${t.deleteBody} ${format(t.clearsStock, { units: units.toLocaleString(locale) })}`
            : t.deleteBody
        }
        confirmLabel={units > 0 ? t.deleteAction : messages.attributes.delete}
        pending={pending}
        onConfirm={apply}
      />
    </>
  );
}
