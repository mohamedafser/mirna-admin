import { FileQuestion, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/button";
import { StatusState } from "@/components/ui/states";
import { getLocale, getMessages } from "@/lib/i18n/server";

export default async function NotFound() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 pt-safe pb-safe">
      <StatusState
        icon={FileQuestion}
        headingLevel="h1"
        title={messages.errors.notFoundTitle}
        description={messages.errors.notFoundBody}
        action={
          <Link href={`/${locale}/admin`} className={buttonClassName()}>
            <LayoutDashboard aria-hidden />
            {messages.common.goToAdmin}
          </Link>
        }
      />
    </main>
  );
}
