import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/server";

// Redirect-only page: it never renders UI, so there's nothing for instant
// navigation validation to check (and the redirect would always fail it).
export const instant = false;

export default async function Home() {
  redirect(`/${await getLocale()}/admin`);
}
