"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, CircleSlash, LoaderCircle, X } from "lucide-react";
import { createContext, use, useMemo, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { setProductsActive } from "@/lib/catalogue/actions";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

interface Selection {
  /** Products on this page, in order (what "select all" selects). */
  ids: string[];
  selected: Set<string>;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const value = use(SelectionContext);
  if (!value) throw new Error("Product selection components need <ProductSelection>.");
  return value;
}

/**
 * Checkbox selection for one page of the product list (list and grid views
 * share it) plus the floating bulk-action bar. The page passes `key` = its
 * query, so changing page, filters or sort starts a fresh selection.
 */
export function ProductSelection({ ids, children }: { ids: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const value = useMemo<Selection>(
    () => ({
      ids,
      selected,
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      setAll: (on) => setSelected(on ? new Set(ids) : new Set()),
      clear: () => setSelected(new Set()),
    }),
    [ids, selected],
  );
  return (
    <SelectionContext value={value}>
      {children}
      <BulkBar />
    </SelectionContext>
  );
}

const boxClassName =
  "size-4 shrink-0 cursor-pointer rounded accent-primary disabled:cursor-not-allowed";

/** One product's checkbox. */
export function SelectProduct({
  id,
  name,
  className,
}: {
  id: string;
  name: string;
  className?: string;
}) {
  const { messages } = useI18n();
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      checked={selected.has(id)}
      onChange={() => toggle(id)}
      aria-label={format(messages.catalogue.products.list.selectNamed, { name })}
      className={cn(boxClassName, className)}
    />
  );
}

/** "Select all on this page" (checked / mixed / unchecked). */
export function SelectAllProducts({
  withLabel = false,
  className,
}: {
  withLabel?: boolean;
  className?: string;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue.products.list;
  const { ids, selected, setAll } = useSelection();
  const count = ids.filter((id) => selected.has(id)).length;
  const all = count > 0 && count === ids.length;
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input
        type="checkbox"
        checked={all}
        ref={(node) => {
          if (node) node.indeterminate = count > 0 && !all;
        }}
        onChange={() => setAll(!all)}
        aria-label={withLabel ? undefined : t.selectAll}
        className={boxClassName}
      />
      {withLabel && <span>{t.selectAll}</span>}
    </label>
  );
}

/**
 * A grid card that knows whether its product is selected: renders <article>
 * with `data-selected`, so the page styles it (data-[selected]:…) without
 * passing functions from the server.
 */
export function SelectableCard({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children: ReactNode;
}) {
  const { selected } = useSelection();
  return (
    <article data-selected={selected.has(id) || undefined} className={className}>
      {children}
    </article>
  );
}

/** Floating bar with the bulk actions, shown while anything is selected. */
function BulkBar() {
  const { messages } = useI18n();
  const t = messages.catalogue.products.list;
  const toast = useToast();
  const { selected, clear } = useSelection();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const count = selected.size;

  function apply(active: boolean) {
    startTransition(async () => {
      const result = await setProductsActive([...selected], active);
      if (!result.ok) {
        toast.error(messages.catalogue.errors[result.error]);
        return;
      }
      toast.success(
        format(active ? t.bulkActivated : t.bulkDeactivated, { count: result.updated }),
      );
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
            aria-label={t.bulkLabel}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 500, damping: 38 }}
            className="fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-brand/30 bg-card/95 p-2 ps-4 shadow-elevated backdrop-blur"
          >
            <p className="me-auto text-sm font-medium tabular-nums" aria-live="polite">
              {format(t.selected, { count })}
            </p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => apply(true)}>
              {pending && !confirming ? (
                <LoaderCircle aria-hidden className="animate-spin" />
              ) : (
                <CircleCheck aria-hidden />
              )}
              {messages.catalogue.common.activate}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => setConfirming(true)}>
              <CircleSlash aria-hidden />
              {messages.catalogue.common.deactivate}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={pending}
              aria-label={t.clearSelection}
              title={t.clearSelection}
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
        title={format(t.bulkDeactivateTitle, { count })}
        description={t.bulkDeactivateBody}
        confirmLabel={messages.catalogue.common.deactivate}
        pending={pending}
        onConfirm={() => apply(false)}
      />
    </>
  );
}
