"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import {
  extensionFor,
  sniffImageType,
  STORE_ASSETS_BUCKET,
  validateImageFile,
  type ImageFileError,
} from "@/lib/catalogue/images";
import { createClient } from "@/lib/supabase/server";

export type HeroSlideError = "forbidden" | "invalid" | "failed" | ImageFileError;
export type HeroSlideResult =
  { ok: true; warning?: "cleanupFailed" } | { ok: false; error: HeroSlideError };

type Supabase = Awaited<ReturnType<typeof createClient>>;

function parsePosition(value: FormDataEntryValue | null): 1 | 2 | null {
  return value === "1" ? 1 : value === "2" ? 2 : null;
}

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[hero] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

async function removeObject(supabase: Supabase, path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(STORE_ASSETS_BUCKET).remove([path]);
  if (error) console.error(`[hero] cleanup failed: path=${path}`);
  return !error;
}

async function currentPath(supabase: Supabase, position: 1 | 2): Promise<string | null> {
  const { data, error } = await supabase
    .from("hero_slides")
    .select("image_path")
    .eq("position", position)
    .maybeSingle();
  if (error) log("read slide", error);
  return data?.image_path ?? null;
}

/**
 * Uploads an image to slot 1 or 2 of the homepage hero. The file is uploaded
 * first, then linked (upsert), then the previous file deleted, so the row
 * never points at a missing file. RLS and storage policies re-check admin.
 */
export async function saveHeroSlide(data: FormData): Promise<HeroSlideResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const position = parsePosition(data.get("position"));
  const file = data.get("image");
  if (!position || !(file instanceof File)) return { ok: false, error: "invalid" };

  const declared = validateImageFile(file);
  if (declared) return { ok: false, error: declared };
  const type = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type) return { ok: false, error: "imageType" };

  const supabase = await createClient();
  const previous = await currentPath(supabase, position);
  const path = `hero/${randomUUID()}.${extensionFor[type]}`;
  const bucket = supabase.storage.from(STORE_ASSETS_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    console.error(`[hero] upload failed: ${uploadError.message}`);
    return { ok: false, error: "failed" };
  }

  const { error } = await supabase.from("hero_slides").upsert({
    position,
    image_path: path,
    image_url: bucket.getPublicUrl(path).data.publicUrl,
    // No updated_at trigger on this table (migration 021): set it here.
    updated_at: new Date().toISOString(),
  });
  if (error) {
    log("link slide", error);
    await removeObject(supabase, path);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  }

  refresh();
  if (previous && !(await removeObject(supabase, previous))) {
    return { ok: true, warning: "cleanupFailed" };
  }
  return { ok: true };
}

/** Empties slot 1 or 2: deletes the row, then its file. */
export async function removeHeroSlide(data: FormData): Promise<HeroSlideResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const position = parsePosition(data.get("position"));
  if (!position) return { ok: false, error: "invalid" };

  const supabase = await createClient();
  const previous = await currentPath(supabase, position);
  const { error } = await supabase.from("hero_slides").delete().eq("position", position);
  if (error) {
    log("remove slide", error);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  }

  refresh();
  if (previous && !(await removeObject(supabase, previous))) {
    return { ok: true, warning: "cleanupFailed" };
  }
  return { ok: true };
}
