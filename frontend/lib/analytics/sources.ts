// ---------------------------------------------------------------------------
// Traffic sources: the one table that says where a visit came from.
//
// Edge-safe (no Node imports): /api/track, the middleware and the backfill
// script all classify with it. To cover a new platform, add a line to
// PLATFORMS; to apply a change to past visits, run
// `npx tsx scripts/backfill-sources.ts --reroll`.
// ---------------------------------------------------------------------------

export type Channel =
    | "direct"
    | "search"
    | "social"
    | "community"
    | "messaging"
    | "email"
    | "ai"
    | "shares"
    | "paid"
    | "campaign"
    | "referral";

export const CHANNEL_LABELS: Record<Channel, string> = {
    direct: "Direct / unknown",
    search: "Search",
    social: "Social",
    community: "Tech communities",
    messaging: "Messaging",
    email: "Email",
    ai: "AI assistants",
    shares: "Reader shares",
    paid: "Paid",
    campaign: "Campaigns",
    referral: "Other sites"
};

interface Platform {
    name: string;
    channel: Channel;
    /** Referrer hosts; subdomains match too. Android app ids arrive as hosts. */
    hosts?: string[];
    /** Host patterns for platforms with many domains (country TLDs). */
    hostPatterns?: RegExp[];
    /** `utm_source` / `ref` values, lowercase. */
    tags?: string[];
}

const PLATFORMS: Platform[] = [
    // Search
    { name: "Google", channel: "search", hosts: ["com.google.android.googlequicksearchbox"], hostPatterns: [/^(www\.)?google\.[a-z.]+$/], tags: ["google"] },
    { name: "Google News", channel: "search", hosts: ["news.google.com", "com.google.android.apps.magazines"], tags: ["googlenews", "google-news"] },
    { name: "Bing", channel: "search", hosts: ["bing.com"], tags: ["bing"] },
    { name: "DuckDuckGo", channel: "search", hosts: ["duckduckgo.com"], tags: ["duckduckgo", "ddg"] },
    { name: "Yahoo", channel: "search", hosts: ["search.yahoo.com", "yahoo.com"], tags: ["yahoo"] },
    { name: "Yandex", channel: "search", hostPatterns: [/^(www\.)?yandex\.[a-z.]+$/, /^ya\.ru$/], tags: ["yandex"] },
    { name: "Baidu", channel: "search", hosts: ["baidu.com"], tags: ["baidu"] },
    { name: "Ecosia", channel: "search", hosts: ["ecosia.org"], tags: ["ecosia"] },
    { name: "Brave Search", channel: "search", hosts: ["search.brave.com"], tags: ["brave"] },
    { name: "Startpage", channel: "search", hosts: ["startpage.com"], tags: ["startpage"] },
    { name: "Qwant", channel: "search", hosts: ["qwant.com"], tags: ["qwant"] },
    { name: "Naver", channel: "search", hosts: ["naver.com"], tags: ["naver"] },

    // AI assistants
    { name: "ChatGPT", channel: "ai", hosts: ["chatgpt.com", "chat.openai.com", "openai.com"], tags: ["chatgpt", "chatgpt.com", "openai"] },
    { name: "Perplexity", channel: "ai", hosts: ["perplexity.ai"], tags: ["perplexity"] },
    { name: "Claude", channel: "ai", hosts: ["claude.ai"], tags: ["claude"] },
    { name: "Gemini", channel: "ai", hosts: ["gemini.google.com", "bard.google.com"], tags: ["gemini"] },
    { name: "Copilot", channel: "ai", hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft"], tags: ["copilot"] },
    { name: "DeepSeek", channel: "ai", hosts: ["chat.deepseek.com", "deepseek.com"], tags: ["deepseek"] },
    { name: "Grok", channel: "ai", hosts: ["grok.com"], tags: ["grok"] },
    { name: "Meta AI", channel: "ai", hosts: ["meta.ai"], tags: ["metaai", "meta-ai"] },
    { name: "Mistral", channel: "ai", hosts: ["chat.mistral.ai"], tags: ["mistral"] },
    { name: "You.com", channel: "ai", hosts: ["you.com"], tags: ["you.com"] },
    { name: "Phind", channel: "ai", hosts: ["phind.com"], tags: ["phind"] },
    { name: "Poe", channel: "ai", hosts: ["poe.com"], tags: ["poe"] },

    // Social
    { name: "Facebook", channel: "social", hosts: ["facebook.com", "fb.com", "fb.me", "com.facebook.katana", "com.facebook.lite"], tags: ["facebook", "fb"] },
    { name: "Instagram", channel: "social", hosts: ["instagram.com", "com.instagram.android"], tags: ["instagram", "ig"] },
    { name: "X", channel: "social", hosts: ["x.com", "twitter.com", "t.co", "com.twitter.android"], tags: ["x", "twitter", "tw"] },
    { name: "LinkedIn", channel: "social", hosts: ["linkedin.com", "lnkd.in", "com.linkedin.android"], tags: ["linkedin", "li"] },
    { name: "Reddit", channel: "social", hosts: ["reddit.com", "redd.it", "com.reddit.frontpage"], tags: ["reddit"] },
    { name: "Threads", channel: "social", hosts: ["threads.net", "threads.com", "com.instagram.barcelona"], tags: ["threads"] },
    { name: "Bluesky", channel: "social", hosts: ["bsky.app", "go.bsky.app", "xyz.blueskyweb.app"], tags: ["bluesky", "bsky"] },
    { name: "Mastodon", channel: "social", hosts: ["mastodon.social", "mastodon.online", "mstdn.social", "mas.to", "fosstodon.org", "hachyderm.io", "infosec.exchange", "techhub.social", "mastodon.world", "social.vivaldi.net"], tags: ["mastodon"] },
    { name: "YouTube", channel: "social", hosts: ["youtube.com", "youtu.be", "com.google.android.youtube"], tags: ["youtube", "yt"] },
    { name: "TikTok", channel: "social", hosts: ["tiktok.com", "com.zhiliaoapp.musically"], tags: ["tiktok"] },
    { name: "Pinterest", channel: "social", hosts: ["pinterest.com", "pin.it", "com.pinterest"], hostPatterns: [/^([a-z]+\.)?pinterest\.[a-z.]+$/], tags: ["pinterest"] },
    { name: "Snapchat", channel: "social", hosts: ["snapchat.com", "com.snapchat.android"], tags: ["snapchat", "snap"] },
    { name: "Quora", channel: "social", hosts: ["quora.com"], tags: ["quora"] },
    { name: "Tumblr", channel: "social", hosts: ["tumblr.com"], tags: ["tumblr"] },
    { name: "VK", channel: "social", hosts: ["vk.com"], tags: ["vk"] },
    { name: "Weibo", channel: "social", hosts: ["weibo.com", "weibo.cn"], tags: ["weibo"] },

    // Tech communities
    { name: "Hacker News", channel: "community", hosts: ["news.ycombinator.com"], tags: ["hackernews", "hn", "ycombinator"] },
    { name: "Product Hunt", channel: "community", hosts: ["producthunt.com"], tags: ["producthunt", "ph"] },
    { name: "Lobsters", channel: "community", hosts: ["lobste.rs"], tags: ["lobsters"] },
    { name: "GitHub", channel: "community", hosts: ["github.com"], tags: ["github"] },
    { name: "dev.to", channel: "community", hosts: ["dev.to"], tags: ["devto", "dev.to"] },
    { name: "Medium", channel: "community", hosts: ["medium.com"], tags: ["medium"] },
    { name: "Hashnode", channel: "community", hosts: ["hashnode.com", "hashnode.dev"], tags: ["hashnode"] },
    { name: "Substack", channel: "community", hosts: ["substack.com"], tags: ["substack"] },
    { name: "Stack Overflow", channel: "community", hosts: ["stackoverflow.com", "stackexchange.com"], tags: ["stackoverflow"] },
    { name: "Indie Hackers", channel: "community", hosts: ["indiehackers.com"], tags: ["indiehackers"] },
    { name: "daily.dev", channel: "community", hosts: ["daily.dev", "app.daily.dev"], tags: ["dailydev", "daily.dev"] },
    { name: "Techmeme", channel: "community", hosts: ["techmeme.com"], tags: ["techmeme"] },
    { name: "Slashdot", channel: "community", hosts: ["slashdot.org"], tags: ["slashdot"] },

    // Messaging
    { name: "WhatsApp", channel: "messaging", hosts: ["whatsapp.com", "web.whatsapp.com", "wa.me", "com.whatsapp", "com.whatsapp.w4b"], tags: ["whatsapp", "wa"] },
    { name: "Telegram", channel: "messaging", hosts: ["t.me", "telegram.org", "web.telegram.org", "org.telegram.messenger"], tags: ["telegram", "tg"] },
    { name: "Slack", channel: "messaging", hosts: ["slack.com", "slack-redir.net", "com.slack"], tags: ["slack"] },
    { name: "Discord", channel: "messaging", hosts: ["discord.com", "discordapp.com", "com.discord"], tags: ["discord"] },
    { name: "Messenger", channel: "messaging", hosts: ["messenger.com", "com.facebook.orca"], tags: ["messenger"] },
    { name: "Microsoft Teams", channel: "messaging", hosts: ["teams.microsoft.com", "teams.live.com", "com.microsoft.teams"], tags: ["teams"] },
    { name: "Signal", channel: "messaging", tags: ["signal"] },
    { name: "LINE", channel: "messaging", hosts: ["line.me", "jp.naver.line.android"], tags: ["line"] },
    { name: "WeChat", channel: "messaging", hosts: ["weixin.qq.com", "com.tencent.mm"], tags: ["wechat"] },
    { name: "SMS", channel: "messaging", tags: ["sms", "imessage"] },

    // Email
    { name: "Gmail", channel: "email", hosts: ["mail.google.com", "com.google.android.gm", "com.google.android.gm.lite"], tags: ["gmail"] },
    { name: "Outlook", channel: "email", hosts: ["outlook.live.com", "outlook.office.com", "outlook.office365.com", "com.microsoft.office.outlook"], tags: ["outlook"] },
    { name: "Yahoo Mail", channel: "email", hosts: ["mail.yahoo.com"], tags: ["yahoomail"] },
    { name: "Proton Mail", channel: "email", hosts: ["mail.proton.me", "proton.me"], tags: ["protonmail", "proton"] },
    { name: "Email", channel: "email", tags: ["email", "newsletter", "mail"] },

    // Reader shares without a platform (the share menu's own tags)
    { name: "Copied link", channel: "shares", tags: ["copy"] },
    { name: "Share sheet", channel: "shares", tags: ["native"] },

    // Readers and aggregators
    { name: "Feedly", channel: "referral", hosts: ["feedly.com"], tags: ["feedly"] },
    { name: "Flipboard", channel: "referral", hosts: ["flipboard.com"], tags: ["flipboard"] }
];

// ---------------------------------------------------------------------------
// In-app browsers: apps that open links inside themselves often send no
// referrer, but their user agent names the app. Only the label is stored.
// ---------------------------------------------------------------------------
const IN_APP: { pattern: RegExp; platform: string }[] = [
    { pattern: /Barcelona/, platform: "Threads" },
    { pattern: /Instagram/, platform: "Instagram" },
    { pattern: /MessengerForiOS|MessengerLite|\bOrca-Android\b|FB_IAB\/Orca/, platform: "Messenger" },
    { pattern: /FBAN|FBAV|FB_IAB|FB4A/, platform: "Facebook" },
    { pattern: /LinkedInApp/, platform: "LinkedIn" },
    { pattern: /musical_ly|BytedanceWebview|TikTok/i, platform: "TikTok" },
    { pattern: /Snapchat/, platform: "Snapchat" },
    { pattern: /Pinterest/, platform: "Pinterest" },
    { pattern: /\bLine\//, platform: "LINE" },
    { pattern: /MicroMessenger/, platform: "WeChat" },
    { pattern: /Twitter(Android)?\b/, platform: "X" },
    { pattern: /\bReddit\b/i, platform: "Reddit" },
    { pattern: /Telegram/i, platform: "Telegram" },
    { pattern: /Discord\//, platform: "Discord" },
    { pattern: /\bSlack\//, platform: "Slack" }
];

/** The app whose built-in browser sent this user agent, if any. */
export function inAppPlatform(userAgent: string): string | null {
    return IN_APP.find((entry) => entry.pattern.test(userAgent))?.platform ?? null;
}

// ---------------------------------------------------------------------------
// Link-preview bots: fetch a page when someone pastes its link into a chat
// or post, so they show where links are shared even when the clicks later
// arrive without a referrer. Order matters: Telegram's and Apple's agents
// also contain "Twitterbot".
// ---------------------------------------------------------------------------
const PREVIEW_BOTS: { pattern: RegExp; platform: string }[] = [
    { pattern: /Facebot Twitterbot/, platform: "iMessage" },
    { pattern: /TelegramBot/, platform: "Telegram" },
    { pattern: /WhatsApp\//, platform: "WhatsApp" },
    { pattern: /Slackbot-LinkExpanding|Slack-LinkExpanding/, platform: "Slack" },
    { pattern: /Discordbot/, platform: "Discord" },
    { pattern: /LinkedInBot/, platform: "LinkedIn" },
    { pattern: /facebookexternalhit/, platform: "Facebook / Messenger / Threads" },
    { pattern: /Twitterbot/, platform: "X" },
    { pattern: /SkypeUriPreview|MicrosoftPreview/, platform: "Microsoft Teams / Skype" },
    { pattern: /Pinterestbot/, platform: "Pinterest" },
    { pattern: /redditbot/, platform: "Reddit" },
    { pattern: /Mastodon\//, platform: "Mastodon" },
    { pattern: /Cardyb/, platform: "Bluesky" },
    { pattern: /Snap URL Preview/, platform: "Snapchat" },
    { pattern: /Viber/, platform: "Viber" }
];

/** The platform building a link preview with this user agent, if any. */
export function previewBotPlatform(userAgent: string): string | null {
    return PREVIEW_BOTS.find((entry) => entry.pattern.test(userAgent))?.platform ?? null;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
const BY_TAG = new Map<string, Platform>();
const BY_HOST = new Map<string, Platform>();
const BY_NAME = new Map<string, Platform>();
for (const platform of PLATFORMS) {
    for (const tag of platform.tags ?? []) BY_TAG.set(tag, platform);
    for (const host of platform.hosts ?? []) BY_HOST.set(host, platform);
    BY_NAME.set(platform.name, platform);
}

/** Exact host, then the longest matching parent domain, then patterns. */
function platformForHost(host: string): Platform | null {
    const bare = host.toLowerCase().replace(/^www\./, "");
    const parts = bare.split(".");
    for (let i = 0; i < parts.length - 1; i++) {
        const match = BY_HOST.get(parts.slice(i).join("."));
        if (match) return match;
    }
    return PLATFORMS.find((p) => p.hostPatterns?.some((pattern) => pattern.test(bare))) ?? null;
}

const PAID_MEDIUMS = new Set(["cpc", "ppc", "paid", "paidsocial", "paid-social", "paid_social", "display", "ads", "ad", "sponsored"]);
const EMAIL_MEDIUMS = new Set(["email", "e-mail", "newsletter", "mail"]);
const SOCIAL_MEDIUMS = new Set(["social", "social-media", "social_media", "organic-social", "organic_social"]);

export interface SourceInput {
    utmSource?: string | null;
    utmMedium?: string | null;
    referrerHost?: string | null;
    inApp?: string | null;
}

export interface Source {
    channel: Channel;
    /** Display name, or the raw host / tag when it isn't in the table. */
    platform: string;
}

/**
 * Where a visit came from. Tags (utm_source / ref) win, then the referrer
 * host, then the in-app browser; with none of them the visit is direct.
 */
export function classifySource({ utmSource, utmMedium, referrerHost, inApp }: SourceInput): Source {
    const tag = utmSource?.trim().toLowerCase();
    const medium = utmMedium?.trim().toLowerCase() ?? "";

    if (tag) {
        const known = BY_TAG.get(tag) ?? platformForHost(tag);
        const platform = known?.name ?? tag;
        if (medium === "share") return { channel: "shares", platform };
        if (PAID_MEDIUMS.has(medium)) return { channel: "paid", platform };
        if (EMAIL_MEDIUMS.has(medium)) return { channel: "email", platform };
        if (known) return { channel: known.channel, platform };
        if (SOCIAL_MEDIUMS.has(medium)) return { channel: "social", platform };
        if (medium === "referral") return { channel: "referral", platform };
        return { channel: "campaign", platform };
    }

    if (referrerHost) {
        const known = platformForHost(referrerHost);
        return known ? { channel: known.channel, platform: known.name } : { channel: "referral", platform: referrerHost };
    }

    if (inApp) {
        const known = BY_NAME.get(inApp);
        return { channel: known?.channel ?? "social", platform: inApp };
    }

    return { channel: "direct", platform: "Direct" };
}

/** Lowercased, trimmed tag value, or undefined when empty. */
export function normalizeTag(value: string | undefined): string | undefined {
    const tag = value?.trim().toLowerCase();
    return tag ? tag.slice(0, 256) : undefined;
}
