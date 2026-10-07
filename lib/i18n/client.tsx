"use client";

import { createContext, use, type ReactNode } from "react";
import { getDirection, type Direction, type Locale } from "@/config/i18n";
import type { Messages } from "./messages";

interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  return (
    <I18nContext value={{ locale, dir: getDirection(locale), messages }}>{children}</I18nContext>
  );
}

/** Locale, direction and messages for Client Components. */
export function useI18n(): I18nContextValue {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used within <I18nProvider>");
  return value;
}
