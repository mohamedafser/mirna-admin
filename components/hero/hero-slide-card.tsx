"use client";

import { Trash2 } from "lucide-react";
import Image from "next/image";
import { useTransition } from "react";
import { ImageDropzone } from "@/components/catalogue/image-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { validateImageFile } from "@/lib/catalogue/images";
import { removeHeroSlide, saveHeroSlide, type HeroSlideResult } from "@/lib/hero/actions";
import { useI18n } from "@/lib/i18n/client";
import { format } from "@/lib/i18n/messages";

/**
 * One homepage hero slot: a wide preview, then upload / replace / remove.
 * Choosing a file uploads it right away (validated here first, and again on
 * the server).
 */
export function HeroSlideCard({
  position,
  imageUrl,
}: {
  position: 1 | 2;
  imageUrl: string | null;
}) {
  const { messages } = useI18n();
  const t = messages.banner;
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const slide = format(t.slide, { n: position });

  function report(result: HeroSlideResult, success: string) {
    if (result.ok) {
      toast.success(success);
      if (result.warning) toast.warning(t.cleanupFailed);
      return;
    }
    const error = result.error;
    if (error === "imageType" || error === "imageSize" || error === "imageEmpty") {
      toast.error(messages.catalogue.errors[error]);
    } else {
      toast.error(error === "forbidden" ? t.forbidden : t.failed);
    }
  }

  function upload(file: File) {
    const invalid = validateImageFile(file);
    if (invalid) {
      toast.error(messages.catalogue.errors[invalid]);
      return;
    }
    const data = new FormData();
    data.set("position", String(position));
    data.set("image", file);
    startTransition(async () =>
      report(await saveHeroSlide(data), format(t.uploaded, { n: position })),
    );
  }

  function remove() {
    const data = new FormData();
    data.set("position", String(position));
    startTransition(async () =>
      report(await removeHeroSlide(data), format(t.removed, { n: position })),
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{slide}</h2>
        {imageUrl && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>
            <Trash2 aria-hidden />
            {t.remove}
          </Button>
        )}
      </div>

      <div className="relative aspect-[16/9] bg-brand-soft text-brand-soft-foreground">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={slide}
            fill
            sizes="(min-width: 1024px) 440px, 100vw"
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-sm opacity-70">
            {t.empty}
          </span>
        )}
        {pending && (
          <span className="absolute inset-0 grid place-items-center bg-background/70">
            <Spinner label={t.saving} />
          </span>
        )}
      </div>

      <div className="p-4">
        <ImageDropzone
          disabled={pending}
          prompt={t.prompt}
          browseLabel={imageUrl ? t.replace : t.browse}
          activeLabel={t.drop}
          hint={t.hint}
          onFiles={([file]) => file && upload(file)}
        />
      </div>
    </Card>
  );
}
