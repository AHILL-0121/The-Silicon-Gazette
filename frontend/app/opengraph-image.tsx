import { OG_SIZE, renderSocialCard } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "The Silicon Gazette: a daily broadsheet of AI, tech and open-source news";

export default function Image() {
  return renderSocialCard({
    kicker: "Daily edition",
    footer: "A new edition every day at 00:10 UTC",
    cacheSeconds: 86_400
  });
}
