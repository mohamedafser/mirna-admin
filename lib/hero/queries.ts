import "server-only";
import { createClient } from "@/lib/supabase/server";

export const HERO_SLIDE_POSITIONS = [1, 2] as const;
export type HeroSlidePosition = (typeof HERO_SLIDE_POSITIONS)[number];

export interface HeroSlide {
  position: HeroSlidePosition;
  imageUrl: string;
  updatedAt: string;
}

/** The homepage hero slides (hero_slides), by position. Loaded per request. */
export async function getHeroSlides(): Promise<HeroSlide[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("hero_slides")
    .select("position, image_url, updated_at")
    .order("position", { ascending: true });
  if (error) {
    console.error(`[hero] read slides: code=${error.code || "-"} message=${error.message || "-"}`);
    throw new Error("Unable to load the homepage banner");
  }
  return data.map((row) => ({
    position: row.position as HeroSlidePosition,
    imageUrl: row.image_url,
    updatedAt: row.updated_at,
  }));
}
