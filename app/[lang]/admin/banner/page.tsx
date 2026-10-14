import type { Metadata } from "next";
import { Suspense } from "react";
import { HeroSlideCard } from "@/components/hero/hero-slide-card";
import { PageSkeleton } from "@/components/ui/states";
import { requireAdmin } from "@/lib/auth/dal";
import { getHeroSlides, HERO_SLIDE_POSITIONS } from "@/lib/hero/queries";
import { getLocale, getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return { title: messages.nav.banner, robots: { index: false, follow: false } };
}

// The session is read behind <Suspense> (Cache Components); requireAdmin()
// guards the content.
export default async function BannerPage() {
  const messages = await getMessages();
  return (
    <Suspense fallback={<PageSkeleton label={messages.common.loading} />}>
      <BannerView />
    </Suspense>
  );
}

/** The storefront homepage hero: two slots shown there as a slideshow. */
async function BannerView() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  await requireAdmin(locale);
  const slides = await getHeroSlides();
  const t = messages.banner;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t.subtitle}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {HERO_SLIDE_POSITIONS.map((position) => (
          <HeroSlideCard
            key={position}
            position={position}
            imageUrl={slides.find((slide) => slide.position === position)?.imageUrl ?? null}
          />
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{t.notice}</p>
    </div>
  );
}
