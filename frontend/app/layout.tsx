import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/styles/gazette.css";
import "./globals.css";

const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "The Silicon Gazette",
    template: "%s | The Silicon Gazette"
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
        alt: "The Silicon Gazette cover card"
      }
    ]
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}