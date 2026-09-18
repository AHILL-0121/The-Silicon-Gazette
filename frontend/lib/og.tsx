import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/** A printed edition's card never changes: let the CDN keep it for a week. */
export const PRINTED_CARD_CACHE_SECONDS = 7 * 24 * 60 * 60;

const PAPER = "#f4f0e7";
const INK = "#161410";
const MUTED = "#6a6458";
const SIGNAL = "#c43210";

async function loadFonts() {
  const dir = join(process.cwd(), "assets/fonts");
  const [serif, serifItalic, mono] = await Promise.all([
    readFile(join(dir, "InstrumentSerif-Regular.ttf")),
    readFile(join(dir, "InstrumentSerif-Italic.ttf")),
    readFile(join(dir, "SpaceMono-Regular.ttf"))
  ]);
  return [
    { name: "Serif", data: serif, style: "normal" as const, weight: 400 as const },
    { name: "Serif", data: serifItalic, style: "italic" as const, weight: 400 as const },
    { name: "Mono", data: mono, style: "normal" as const, weight: 400 as const }
  ];
}

function fitHeadline(text: string): number {
  if (text.length > 110) return 58;
  if (text.length > 70) return 70;
  return 84;
}

/**
 * The PNG social card: nameplate, dateline and the lead (or story) headline.
 * Social networks don't accept SVG preview images.
 */
export async function renderSocialCard({
  kicker,
  headline,
  footer,
  cacheSeconds = 300
}: {
  kicker: string;
  headline?: string;
  footer: string;
  /** How long browsers and the CDN may keep the PNG. Printed editions never change. */
  cacheSeconds?: number;
}) {
  const fonts = await loadFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: PAPER,
          color: INK,
          padding: "56px 72px",
          fontFamily: "Serif"
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Mono", fontSize: 20, color: MUTED, letterSpacing: 2 }}>
          <span>{kicker.toUpperCase()}</span>
          <span style={{ display: "flex", alignItems: "center", color: SIGNAL }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, background: SIGNAL, marginRight: 12 }} />
            THE WIRE
          </span>
        </div>
        <div style={{ display: "flex", height: 2, background: INK, marginTop: 18 }} />
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1, marginTop: 22 }}>
          <span>The&nbsp;</span>
          <span style={{ fontStyle: "italic", color: SIGNAL }}>Silicon</span>
          <span>&nbsp;Gazette</span>
        </div>
        {/* Satori has no double borders: two rules make the broadsheet double line. */}
        <div style={{ display: "flex", height: 2, background: INK, marginTop: 22 }} />
        <div style={{ display: "flex", height: 2, background: INK, marginTop: 3 }} />
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            fontSize: headline ? fitHeadline(headline) : 64,
            lineHeight: 1.02,
            letterSpacing: -1
          }}
        >
          {headline ?? "All the code that's fit to print."}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "Mono", fontSize: 18, color: MUTED, letterSpacing: 1 }}>
          <span>{footer}</span>
          <span>AI · TECH · OPEN SOURCE</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts,
      headers: {
        "Cache-Control": `public, max-age=${Math.min(cacheSeconds, 86_400)}, s-maxage=${cacheSeconds}, stale-while-revalidate=86400`
      }
    }
  );
}
