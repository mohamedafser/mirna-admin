import type { Metadata, Viewport } from "next";
import { Geist_Mono, Montserrat, Nunito_Sans, Tajawal } from "next/font/google";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { getDirection, locales } from "@/config/i18n";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { sidebarInitScript } from "@/lib/sidebar";
import { themeInitScript } from "@/lib/theme";
import "../globals.css";

// Same type system as mirna-storefront: Nunito Sans (body), Montserrat
// (display: headings, navigation, buttons) and Tajawal for Arabic. Geist Mono
// stays for SKUs and other codes.
const body = Nunito_Sans({ variable: "--font-body", subsets: ["latin"] });
const heading = Montserrat({ variable: "--font-heading", subsets: ["latin"] });
const latinMono = Geist_Mono({ variable: "--font-latin-mono", subsets: ["latin"] });
const arabic = Tajawal({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["300", "400", "500", "700"],
});

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const messages = await getMessages();
  return {
    title: { default: messages.app.name, template: `%s | ${messages.app.name}` },
    description: messages.app.description,
    applicationName: "Mirna Admin",
    // Private back office: keep it out of search engines.
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title: "Mirna Admin", statusBarStyle: "default" },
    formatDetection: { telephone: false, email: false, address: false },
    icons: {
      icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // enables env(safe-area-inset-*)
  // Matches --background in globals.css.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f3" },
    { media: "(prefers-color-scheme: dark)", color: "#170d0e" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/[lang]">) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      className={`${body.variable} ${heading.variable} ${latinMono.variable} ${arabic.variable} antialiased`}
      // The inline script may set data-theme before React hydrates.
      suppressHydrationWarning
    >
      <head>
        {/* ";" between the two IIFEs: without it the second is called on the first's result. */}
        <script dangerouslySetInnerHTML={{ __html: `${themeInitScript};${sidebarInitScript}` }} />
      </head>
      {/* Browser extensions (e.g. ColorZilla's cz-shortcut-listen) add body attributes. */}
      <body className="min-h-dvh" suppressHydrationWarning>
        <I18nProvider locale={locale} messages={messages}>
          {children}
        </I18nProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
