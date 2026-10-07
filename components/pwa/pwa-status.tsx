"use client";

import { AppWindow, Cog, Wifi, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { DetailList } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/client";

type SwState = "active" | "inactive" | "unsupported";
interface PwaSnapshot {
  standalone: boolean;
  serviceWorker: SwState;
  online: boolean;
}

let cached: PwaSnapshot | null = null;

function getSnapshot(): PwaSnapshot {
  const next: PwaSnapshot = {
    standalone:
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari home-screen apps
      ("standalone" in navigator && navigator.standalone === true),
    serviceWorker: !("serviceWorker" in navigator)
      ? "unsupported"
      : navigator.serviceWorker.controller
        ? "active"
        : "inactive",
    online: navigator.onLine,
  };
  // useSyncExternalStore needs a stable reference while nothing changed.
  if (
    cached &&
    cached.standalone === next.standalone &&
    cached.serviceWorker === next.serviceWorker &&
    cached.online === next.online
  ) {
    return cached;
  }
  cached = next;
  return next;
}

function subscribe(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  navigator.serviceWorker?.addEventListener("controllerchange", onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
    navigator.serviceWorker?.removeEventListener("controllerchange", onChange);
  };
}

/** Shows install/display mode, service worker and network status. */
export function PwaStatus() {
  const { messages } = useI18n();
  const t = messages.admin.pwa;
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const pending = <span className="inline-block h-4 w-16 animate-pulse bg-muted" />;

  const sw = {
    active: (
      <Badge tone="success" dot>
        {t.swActive}
      </Badge>
    ),
    inactive: <Badge dot>{t.swInactive}</Badge>,
    unsupported: (
      <Badge tone="error" dot>
        {t.swUnsupported}
      </Badge>
    ),
  };

  return (
    <DetailList
      items={[
        {
          icon: AppWindow,
          label: t.displayMode,
          value: state ? (state.standalone ? t.standalone : t.browser) : pending,
        },
        { icon: Cog, label: t.serviceWorker, value: state ? sw[state.serviceWorker] : pending },
        {
          icon: state && !state.online ? WifiOff : Wifi,
          label: t.network,
          value: state ? (
            <Badge tone={state.online ? "success" : "error"} dot>
              {state.online ? t.online : t.offline}
            </Badge>
          ) : (
            pending
          ),
        },
      ]}
    />
  );
}
