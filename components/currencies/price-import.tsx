"use client";

import { LoaderCircle, Upload } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { importPrices, type PriceImportResult } from "@/lib/currencies/actions";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";

/**
 * Upload a price CSV. Nothing is saved while any line has a problem; the
 * problems are listed by line so the file can be fixed and uploaded again.
 */
export function PriceImport() {
  const { messages } = useI18n();
  const t = messages.currencies.csv;
  const toast = useToast();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PriceImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function upload() {
    if (!file || pending) return;
    const data = new FormData();
    data.set("file", file);
    startTransition(async () => {
      const outcome = await importPrices(data);
      setResult(outcome);
      if (outcome.ok) {
        toast.success(format(t.imported, { updated: outcome.updated, removed: outcome.removed }));
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="sr-only">
          {t.file}
        </label>
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setResult(null);
          }}
          className="min-w-0 flex-1 text-sm file:me-3 file:rounded-md file:border file:bg-card file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <Button size="sm" disabled={!file || pending} aria-busy={pending} onClick={upload}>
          {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : <Upload aria-hidden />}
          {pending ? t.importing : t.import}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t.hint}</p>

      {result && !result.ok && (
        <Alert>
          <p>{t.errors[result.error]}</p>
          {result.issues && result.issues.length > 0 && (
            <ul className="mt-2 grid gap-0.5 text-xs">
              {result.issues.map((issue) => (
                <li key={`${issue.line}-${issue.error}`}>
                  {format(t.issue, { line: issue.line, error: t.rowErrors[issue.error] })}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}
