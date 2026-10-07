"use client";

import { ImageUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { IMAGE_ACCEPT } from "@/lib/catalogue/images";
import { cn } from "@/lib/utils/cn";

/**
 * Upload area: click (a real button, keyboard accessible) or drag and drop.
 * Hands raw files to `onFiles`; validation happens in the caller.
 */
export function ImageDropzone({
  onFiles,
  multiple = false,
  disabled = false,
  prompt,
  browseLabel,
  activeLabel,
  hint,
  className,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  prompt: string;
  browseLabel: string;
  activeLabel: string;
  hint?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hintId = useId();

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-3 py-4 text-center text-sm transition-colors",
        dragging ? "border-primary bg-primary/5" : "border-border bg-muted/30",
        disabled && "opacity-60",
        className,
      )}
    >
      <ImageUp aria-hidden className="size-5 text-muted-foreground" />
      <p>
        {dragging ? (
          activeLabel
        ) : (
          <>
            {prompt}{" "}
            <button
              type="button"
              disabled={disabled}
              aria-describedby={hint ? hintId : undefined}
              onClick={() => inputRef.current?.click()}
              className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
            >
              {browseLabel}
            </button>
          </>
        )}
      </p>
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple={multiple}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Reset so choosing the same file again still triggers a change.
          event.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
