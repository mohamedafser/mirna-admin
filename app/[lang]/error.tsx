"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StatusState } from "@/components/ui/states";
import { useI18n } from "@/lib/i18n/client";

// Generic message only: error details are never shown to users.
export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const { messages } = useI18n();

  useEffect(() => {
    // Replace with an error-reporting service in a later phase.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60dvh] items-center justify-center px-4 pt-safe">
      <StatusState
        icon={TriangleAlert}
        tone="error"
        headingLevel="h1"
        title={messages.errors.unexpectedTitle}
        description={messages.errors.unexpectedBody}
        action={
          <Button onClick={() => retry()}>
            <RotateCw aria-hidden />
            {messages.common.retry}
          </Button>
        }
      />
    </main>
  );
}
