"use client";

import { useEffect } from "react";

/**
 * Asks the browser to confirm leaving the page (reload, close tab, external
 * navigation) while a form has unsaved changes. Deliberately not applied to
 * every in-app click, to stay unobtrusive.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
