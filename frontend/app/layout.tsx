import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Newsreader } from "next/font/google";
import type { ReactNode } from "react";

import { BackToTop } from "@/components/BackToTop";
import { JsonLd } from "@/components/JsonLd";
import { SmoothScroll } from "@/components/SmoothScroll";
import { Toaster } from "@/components/Toaster";
import { Tracker } from "@/components/analytics/Tracker";

import { OPEN_GRAPH_DEFAULTS } from "@/lib/metadata";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import { siteGraph } from "@/lib/structured-data";
import { THEME_SCRIPT } from "@/lib/theme-script";

import "./globals.css";

// Self-hosted at build time by next/font: no render-blocking third-party CSS.
const display = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display"
});

// Newsreader has an optical-size axis tuned for long-form reading.
const serif = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
  variable: "--font-serif"
});

const sans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-sans" });
// Small labels only: not worth a preload request competing with the headline fonts.
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-mono", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    ...OPEN_GRAPH_DEFAULTS,
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/"
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION
  }
};

export const viewport: Viewport = {
  themeColor: "#f4f0e7"
};


export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${display.variable} ${serif.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <JsonLd data={siteGraph()} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        <SmoothScroll>{children}</SmoothScroll>
        <BackToTop />
        <Toaster />
        <Tracker />
      </body>
    </html>
  );
}
