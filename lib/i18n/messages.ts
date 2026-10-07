import type { Locale } from "@/config/i18n";
import type en from "@/messages/en.json";

/** Shape of every messages/<locale>.json file; English is the reference. */
export type Messages = typeof en;

// Each locale must provide the full English key set (checked at compile time).
export const messageLoaders: Record<Locale, () => Promise<Messages>> = {
  en: () => import("@/messages/en.json").then((m) => m.default),
  ar: () => import("@/messages/ar.json").then((m) => m.default),
};

/** Replaces `{name}` placeholders: format("Hi {name}", { name: "Sara" }). */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
