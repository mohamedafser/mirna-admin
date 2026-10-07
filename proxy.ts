import { NextResponse, type NextRequest } from "next/server";
import { isLocale, LOCALE_COOKIE, type Locale } from "@/config/i18n";
import { activeRegion } from "@/config/region";
import { REDIRECT_PARAM } from "@/lib/auth/redirect";
import { matchAcceptLanguage } from "@/lib/i18n/negotiate";
import { redirectPreservingSession, updateSession } from "@/lib/supabase/proxy";

const ONE_YEAR = 60 * 60 * 24 * 365;

// Sections that need a signed-in user. The role check happens server-side in
// the DAL (lib/auth/dal.ts); this is only the fast, optimistic redirect.
const PROTECTED_SECTIONS = new Set(["admin", "access-denied"]);

function preferredLocale(request: NextRequest): Locale {
  const fromCookie = request.cookies.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return matchAcceptLanguage(request.headers.get("accept-language")) ?? activeRegion.defaultLocale;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first, section] = pathname.split("/");

  // 1. Unprefixed URL (/admin, /login, /) → add the preferred locale.
  if (!isLocale(first)) {
    const url = request.nextUrl.clone();
    url.pathname = `/${preferredLocale(request)}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url);
  }
  const locale = first;

  // 2. Refresh the Supabase session cookie.
  const { response, userId } = await updateSession(request);

  // 3. Optimistic auth redirects.
  if (PROTECTED_SECTIONS.has(section) && !userId) {
    const url = new URL(`/${locale}/login`, request.url);
    // Remember the admin page they wanted (validated again after sign-in).
    if (section === "admin") {
      url.searchParams.set(REDIRECT_PARAM, pathname + request.nextUrl.search);
    }
    return redirectPreservingSession(response, url);
  }
  if (section === "login" && userId) {
    return redirectPreservingSession(response, new URL(`/${locale}/admin`, request.url));
  }

  // 4. Remember the language the user is browsing in.
  if (request.cookies.get(LOCALE_COOKIE)?.value !== locale) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  // Skip static assets, PWA files and image files.
  matcher: [
    "/((?!_next/static|_next/image|icons/|sw\\.js|offline\\.html|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml)$).*)",
  ],
};
