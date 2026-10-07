import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

// Unmatched URLs outside a locale render here (bypasses the [lang] layout).
// Bilingual because the locale is unknown at this point.
export const metadata: Metadata = {
  title: "404 | Mirna Admin",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <main className="grid max-w-md gap-6 text-center">
          <div>
            <h1 className="text-xl font-semibold">Page not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The page you&apos;re looking for doesn&apos;t exist or has moved.
            </p>
          </div>
          <div lang="ar" dir="rtl">
            <p className="text-xl font-semibold">الصفحة غير موجودة</p>
            <p className="mt-2 text-sm text-muted-foreground">
              الصفحة التي تبحث عنها غير موجودة أو تم نقلها.
            </p>
          </div>
          <Link
            href="/admin"
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            Mirna Admin
          </Link>
        </main>
      </body>
    </html>
  );
}
