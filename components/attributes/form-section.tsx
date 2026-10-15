import type { ReactNode } from "react";

/** Titled fieldset card, matching the product form's sections. */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <legend className="float-start mb-1 w-full text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}
