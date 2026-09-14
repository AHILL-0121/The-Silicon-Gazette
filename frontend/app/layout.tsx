import type { Metadata } from "next";
import type { ReactNode } from "react";
import { UnifrakturMaguntia, Playfair_Display, IM_Fell_English, Source_Serif_4 } from "next/font/google";

import { SmoothScrollProvider } from "@/components/SmoothScrollProvider";
import { ReadingProgress } from "@/components/ReadingProgress";
import { BackToTop } from "@/components/BackToTop";

import "@/styles/gazette.css";
import "./globals.css";

// PERF-04: Self-hosted via next/font — no render-blocking @import
const unifraktur = UnifrakturMaguntia({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-unifraktur",
});

const playfair = Playfair_Display({
  weight: ["400", "700", "900"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-playfair",
});

const imFell = IM_Fell_English({
  weight: ["400"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-im-fell",
});

// Source Serif 4 for long-form body copy (replaces IM Fell for readability)
const sourceSerif = Source_Serif_4({
  weight: ["400", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-serif",
});

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "The Silicon Gazette",
    template: "%s | The Silicon Gazette",
  },
  description: "All the code that's fit to print.",
  openGraph: {
    title: "The Silicon Gazette",
    description: "A daily broadsheet of AI, tech, and open-source headlines.",
    images: [
      {
        url: "/og/edition-card.svg",
        width: 1200,
        height: 630,
        alt: "The Silicon Gazette cover card",
      },
    ],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fontClasses = [
    unifraktur.variable,
    playfair.variable,
    imFell.variable,
    sourceSerif.variable,
  ].join(" ");

  return (
    <html lang="en" className={fontClasses}>
      <body>
        <SmoothScrollProvider>
          <ReadingProgress />
          {children}
          <BackToTop />
        </SmoothScrollProvider>
      </body>
    </html>
  );
}