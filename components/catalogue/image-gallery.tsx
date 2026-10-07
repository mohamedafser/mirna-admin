"use client";

import { ArrowLeft, ArrowRight, Star, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/form";
import { ALT_TEXT_MAX_LENGTH } from "@/lib/catalogue/images";
import { format } from "@/lib/i18n/messages";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils/cn";
import { CatalogueImage } from "./catalogue-image";

export interface GalleryItem {
  key: string;
  src: string;
  alt: string;
  isPrimary: boolean;
}

/**
 * Compact product gallery: a thumbnail grid (order = storefront order) and an
 * edit panel for the selected image — alt text, primary, move, delete.
 * Used both for images waiting to be uploaded (new product, `local`) and for
 * stored images (product page). The parent decides what each action does.
 */
export function ImageGallery({
  items,
  productName,
  busy = false,
  local = false,
  onSetPrimary,
  onMove,
  onRemove,
  onAltChange,
  onAltSave,
}: {
  items: GalleryItem[];
  productName: string;
  busy?: boolean;
  /** Local previews (blob: URLs): plain <img>, live alt text, no delete confirmation. */
  local?: boolean;
  onSetPrimary: (key: string) => void;
  onMove: (key: string, offset: -1 | 1) => void;
  onRemove: (key: string) => void;
  /** Local mode: alt text updates as you type. */
  onAltChange?: (key: string, alt: string) => void;
  /** Stored mode: alt text is saved with a button. */
  onAltSave?: (key: string, alt: string) => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.key === selectedKey),
  );
  const selected = items[selectedIndex];

  if (items.length === 0) return null;

  const altFor = (item: GalleryItem, index: number) =>
    item.alt || format(t.images.imageAlt, { n: index + 1, name: productName || "" });

  return (
    <div className="grid gap-3">
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-4">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-label={format(t.images.selectImage, {
                  n: index + 1,
                  alt: altFor(item, index),
                })}
                onClick={() => setSelectedKey(item.key)}
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg ring-offset-2 ring-offset-card transition-shadow",
                  isSelected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-border",
                )}
              >
                {local ? (
                  // Local blob: preview; next/image can't optimize blob: URLs.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.src} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <CatalogueImage src={item.src} alt="" sizes="96px" className="w-full" />
                )}
                {item.isPrimary && (
                  <span className="absolute start-1 top-1 inline-flex size-5 items-center justify-center bg-primary text-primary-foreground">
                    <Star aria-hidden className="size-3 fill-current" />
                  </span>
                )}
                <span className="absolute end-1 bottom-1 bg-background/80 px-1 text-[0.6875rem] font-medium tabular-nums">
                  {index + 1}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {selected && (
        <SelectedPanel
          key={selected.key}
          item={selected}
          index={selectedIndex}
          total={items.length}
          busy={busy}
          local={local}
          onSetPrimary={onSetPrimary}
          onMove={onMove}
          onRemove={onRemove}
          onAltChange={onAltChange}
          onAltSave={onAltSave}
        />
      )}
    </div>
  );
}

function SelectedPanel({
  item,
  index,
  total,
  busy,
  local,
  onSetPrimary,
  onMove,
  onRemove,
  onAltChange,
  onAltSave,
}: {
  item: GalleryItem;
  index: number;
  total: number;
  busy: boolean;
  local: boolean;
  onSetPrimary: (key: string) => void;
  onMove: (key: string, offset: -1 | 1) => void;
  onRemove: (key: string) => void;
  onAltChange?: (key: string, alt: string) => void;
  onAltSave?: (key: string, alt: string) => void;
}) {
  const { messages } = useI18n();
  const t = messages.catalogue;
  const [alt, setAlt] = useState(item.alt);
  const [confirming, setConfirming] = useState(false);
  const altId = useId();

  return (
    <div className="grid gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {format(t.images.editing, { n: index + 1, total })}
        {item.isPrimary && (
          <Badge tone="primary">
            <Star aria-hidden className="fill-current" />
            {t.images.primary}
          </Badge>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={altId} className="text-xs">
          {t.images.alt}
        </Label>
        <div className="flex gap-2">
          <Input
            id={altId}
            value={alt}
            maxLength={ALT_TEXT_MAX_LENGTH}
            placeholder={t.images.altPlaceholder}
            disabled={busy}
            onChange={(event) => {
              setAlt(event.target.value);
              onAltChange?.(item.key, event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter saves the alt text instead of submitting a surrounding form.
              if (event.key === "Enter") {
                event.preventDefault();
                if (onAltSave && alt.trim() !== item.alt) onAltSave(item.key, alt);
              }
            }}
          />
          {onAltSave && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 shrink-0"
              disabled={busy || alt.trim() === item.alt}
              onClick={() => onAltSave(item.key, alt)}
            >
              {t.common.save}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {!item.isPrimary && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onSetPrimary(item.key)}
          >
            <Star aria-hidden />
            {t.images.setPrimary}
          </Button>
        )}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={busy || index === 0}
          aria-label={t.images.moveUp}
          title={t.images.moveUp}
          onClick={() => onMove(item.key, -1)}
        >
          {/* "Earlier" points toward the reading start (mirrors in RTL). */}
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={busy || index === total - 1}
          aria-label={t.images.moveDown}
          title={t.images.moveDown}
          onClick={() => onMove(item.key, 1)}
        >
          <ArrowRight aria-hidden className="rtl:-scale-x-100" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="ms-auto text-error hover:text-error"
          onClick={() => (local ? onRemove(item.key) : setConfirming(true))}
        >
          <Trash2 aria-hidden />
          {local ? t.images.removePending : t.images.remove}
        </Button>
      </div>

      {!local && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t.images.removeTitle}
          description={t.images.removeBody}
          confirmLabel={t.images.remove}
          pending={busy}
          onConfirm={() => {
            onRemove(item.key);
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
