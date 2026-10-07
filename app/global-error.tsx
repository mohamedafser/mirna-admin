"use client";

import { useEffect } from "react";
import "./globals.css";

// Last-resort boundary for errors in the root layout itself. It replaces the
// layout (and the i18n provider), so the copy is bilingual and static.
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" dir="ltr">
      <body className="flex min-h-dvh items-center justify-center p-6">
        <main className="grid max-w-md gap-6 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p lang="ar" dir="rtl" className="text-xl font-semibold">
            حدث خطأ ما
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="mx-auto h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again · إعادة المحاولة
          </button>
        </main>
      </body>
    </html>
  );
}
