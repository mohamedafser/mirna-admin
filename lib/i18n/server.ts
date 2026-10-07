import { notFound } from "next/navigation";
import { lang } from "next/root-params";
import { isLocale, type Locale } from "@/config/i18n";
import { messageLoaders, type Messages } from "./messages";

/** Current locale from the `[lang]` root segment (Server Components only). */
export async function getLocale(): Promise<Locale> {
  const value = await lang();
  if (!isLocale(value)) notFound();
  return value;
}

/** Messages for the current locale (Server Components only). */
export async function getMessages(): Promise<Messages> {
  return messageLoaders[await getLocale()]();
}
