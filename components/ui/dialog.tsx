"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

/**
 * Centered modal built on <dialog>: focus trap, Escape, inert background and
 * top-layer stacking come from the browser (same approach as Sheet).
 * Full-width bottom sheet on phones, centered card from sm up.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  dismissible = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  /** false while a request is in flight: Escape / backdrop / ✕ do nothing. */
  dismissible?: boolean;
}) {
  const { messages } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        // Escape: keep it open while busy; otherwise close through React state.
        event.preventDefault();
        if (dismissible) onOpenChange(false);
      }}
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onOpenChange(false);
      }}
      className={cn(
        "m-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border bg-card p-0 text-card-foreground shadow-card sm:mb-auto sm:max-w-lg sm:rounded-2xl",
        "backdrop:bg-black/40 backdrop:backdrop-blur-[2px] open:animate-[fade-in_160ms_ease-out]",
        className,
      )}
    >
      {open && (
        <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
          <div className="mb-5 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="caps text-sm leading-tight font-medium">
                {title}
              </h2>
              {description && (
                <div id={descriptionId} className="mt-1.5 text-sm text-muted-foreground">
                  {description}
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={messages.catalogue.common.close}
              disabled={!dismissible}
              onClick={() => onOpenChange(false)}
            >
              <X aria-hidden />
            </Button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** "Are you sure?" dialog for state changes such as deactivating. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending,
  onConfirm,
  tone = "error",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** Defaults to "Cancel"; override when the action itself is a cancellation. */
  cancelLabel?: string;
  pending: boolean;
  onConfirm: () => void;
  tone?: "error" | "primary";
}) {
  const { messages } = useI18n();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      dismissible={!pending}
      className="sm:max-w-md"
    >
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
          {cancelLabel ?? messages.catalogue.common.cancel}
        </Button>
        <Button
          disabled={pending}
          aria-busy={pending}
          onClick={onConfirm}
          className={cn(tone === "error" && "bg-error text-error-foreground hover:bg-error/90")}
        >
          {pending && <LoaderCircle aria-hidden className="animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
