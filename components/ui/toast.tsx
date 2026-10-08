"use client";

import { CircleAlert, CircleCheck, TriangleAlert, X } from "lucide-react";
import { createContext, use, useCallback, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";

/**
 * Minimal toast notifications (the app's only toast system). Messages are
 * announced through a polite live region and dismiss themselves after a few
 * seconds; errors stay until closed. Top-center on phones, top inline-end
 * (top right; top left in RTL) on larger screens. Newest is on top.
 */

type Tone = "success" | "error" | "warning";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const tones = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  error: { icon: CircleAlert, className: "text-error" },
} as const;

const ToastContext = createContext<((tone: Tone, message: string) => void) | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { messages } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: Tone, message: string) => {
      const id = ++nextId;
      setToasts((current) => [...current.slice(-2), { id, tone, message }]);
      if (tone !== "error") setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col-reverse items-center gap-2 p-4 pt-[calc(1rem+env(safe-area-inset-top))] sm:items-end sm:px-6"
      >
        {toasts.map((toast) => {
          const { icon: Icon, className } = tones[toast.tone];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex w-full max-w-sm animate-[fade-in_160ms_ease-out] items-start gap-3 rounded-xl border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-card"
            >
              <Icon aria-hidden className={cn("mt-px size-4 shrink-0", className)} />
              <p className="min-w-0 flex-1">{toast.message}</p>
              <button
                type="button"
                aria-label={messages.catalogue.common.dismiss}
                onClick={() => dismiss(toast.id)}
                className="-m-1 rounded-md p-1 text-muted-foreground hover:text-foreground"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const show = use(ToastContext);
  if (!show) throw new Error("useToast must be used within <ToastProvider>");
  return {
    success: (message: string) => show("success", message),
    warning: (message: string) => show("warning", message),
    error: (message: string) => show("error", message),
  };
}
