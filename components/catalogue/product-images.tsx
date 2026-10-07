"use client";

import { CircleAlert, LoaderCircle, X } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  deleteProductImage,
  reorderProductImages,
  setPrimaryProductImage,
  updateProductImageAlt,
  uploadProductImage,
  type ActionResult,
} from "@/lib/catalogue/actions";
import { validateImageFile } from "@/lib/catalogue/images";
import { useI18n } from "@/lib/i18n/client";
import { ImageDropzone } from "./image-dropzone";
import { ImageGallery } from "./image-gallery";

export interface ManagedImage {
  id: string;
  public_url: string | null;
  alt_text: string | null;
  is_primary: boolean;
}

interface QueueItem {
  key: number;
  name: string;
  status: "uploading" | "error";
  error?: string;
}

let nextKey = 0;

/**
 * Stored product images (product page). Every change is saved immediately
 * through a Server Action and the server re-renders the list, so the gallery
 * always shows what is stored. Uploads run one at a time so they never race
 * for the primary slot or sort order.
 */
export function ProductImages({
  productId,
  productName,
  images,
}: {
  productId: string;
  productName: string;
  images: ManagedImage[];
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const toast = useToast();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [busy, startTransition] = useTransition();

  function addFiles(files: File[]) {
    const rejected: QueueItem[] = [];
    const valid: File[] = [];
    for (const file of files) {
      const error = validateImageFile(file);
      if (error)
        rejected.push({ key: ++nextKey, name: file.name, status: "error", error: t.errors[error] });
      else valid.push(file);
    }
    setQueue((current) => [...current, ...rejected]);
    if (valid.length === 0) return;

    startTransition(async () => {
      let uploaded = 0;
      for (const file of valid) {
        const key = ++nextKey;
        setQueue((current) => [...current, { key, name: file.name, status: "uploading" }]);
        const data = new FormData();
        data.set("file", file);
        const result = await uploadProductImage(productId, data);
        setQueue((current) =>
          result.ok
            ? current.filter((entry) => entry.key !== key)
            : current.map((entry) =>
                entry.key === key
                  ? { ...entry, status: "error", error: t.errors[result.error] }
                  : entry,
              ),
        );
        if (result.ok) uploaded += 1;
      }
      if (uploaded > 0) toast.success(t.images.uploaded);
    });
  }

  function run(action: () => Promise<ActionResult>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return void toast.error(t.errors[result.error]);
      toast.success(success);
      if (result.warning) toast.warning(t.errors[result.warning]);
    });
  }

  const ids = images.map((image) => image.id);

  return (
    <div className="grid gap-3">
      <ImageGallery
        productName={productName}
        busy={busy}
        items={images.map((image) => ({
          key: image.id,
          src: image.public_url ?? "",
          alt: image.alt_text ?? "",
          isPrimary: image.is_primary,
        }))}
        onSetPrimary={(id) => run(() => setPrimaryProductImage(id), t.images.primarySet)}
        onMove={(id, offset) => {
          const order = [...ids];
          const index = order.indexOf(id);
          [order[index], order[index + offset]] = [order[index + offset], order[index]];
          run(() => reorderProductImages(productId, order), t.images.reordered);
        }}
        onRemove={(id) => run(() => deleteProductImage(id), t.images.removed)}
        onAltSave={(id, alt) => run(() => updateProductImageAlt(id, alt), t.images.altSaved)}
      />

      {queue.length > 0 && (
        <ul className="grid gap-1.5" aria-live="polite">
          {queue.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
            >
              {item.status === "uploading" ? (
                <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <CircleAlert aria-hidden className="size-3.5 shrink-0 text-error" />
              )}
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {item.name}
                {item.error && <span className="text-error"> — {item.error}</span>}
                {item.status === "uploading" && (
                  <span className="text-muted-foreground"> — {t.images.uploadingShort}</span>
                )}
              </span>
              {item.status === "error" && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6"
                  aria-label={t.common.dismiss}
                  onClick={() =>
                    setQueue((current) => current.filter((entry) => entry.key !== item.key))
                  }
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ImageDropzone
        multiple
        disabled={busy}
        prompt={t.images.dropzone}
        browseLabel={t.images.browse}
        activeLabel={t.images.dropActive}
        hint={images.length === 0 ? t.images.hint : undefined}
        onFiles={addFiles}
      />
    </div>
  );
}
