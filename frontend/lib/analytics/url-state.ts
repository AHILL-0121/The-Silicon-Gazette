// Dashboard view <-> URL query string, so a view can be bookmarked or sent.
//
//   ?r=30d                      quick range (24h 7d 30d 90d all)
//   ?from=2026-11-01&to=2026-11-08   custom days (UTC)
//   &tz=IST &clock=12h &density=compact &cmp=1 &story=<slug>
//
// Defaults (7d, UTC, 24h, comfortable, no compare) are left out to keep links short.

import type { Filters } from "./filters";
import type { ClockMode, Zone } from "./timezone";

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "all";
export const RANGE_KEYS: RangeKey[] = ["24h", "7d", "30d", "90d", "all"];

export type Selection = { kind: "preset"; key: RangeKey } | { kind: "custom"; from: string; to: string };
export type DensityMode = "comfortable" | "compact";

export interface ViewState {
    selection: Selection;
    zone: Zone;
    clock: ClockMode;
    density: DensityMode;
    compare: boolean;
    story: string | null;
    /** Device / country / source channel narrowing every number on the page. */
    filters: Filters;
}

const DEFAULT_PRESET: RangeKey = "7d";

export const DEFAULT_VIEW: ViewState = {
    selection: { kind: "preset", key: DEFAULT_PRESET },
    zone: "UTC",
    clock: "24h",
    density: "comfortable",
    compare: false,
    story: null,
    filters: {}
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: string | null): value is string {
    return value !== null && DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Reads the query string; anything missing or malformed falls back to `base`. */
export function parseView(search: string, base: ViewState = DEFAULT_VIEW): ViewState {
    const q = new URLSearchParams(search);
    const view: ViewState = { ...base };

    const from = q.get("from");
    const to = q.get("to");
    const preset = q.get("r");
    if (validDay(from) && validDay(to) && from <= to) {
        view.selection = { kind: "custom", from, to };
    } else if (preset && (RANGE_KEYS as string[]).includes(preset)) {
        view.selection = { kind: "preset", key: preset as RangeKey };
    }

    const tz = q.get("tz");
    if (tz === "UTC" || tz === "IST") view.zone = tz;
    const clock = q.get("clock");
    if (clock === "12h" || clock === "24h") view.clock = clock;
    const density = q.get("density");
    if (density === "comfortable" || density === "compact") view.density = density;
    if (q.has("cmp")) view.compare = q.get("cmp") === "1";
    const story = q.get("story");
    if (story !== null) view.story = story.slice(0, 200) || null;

    const filters: Filters = {};
    const device = q.get("f_device");
    if (device === "mobile" || device === "tablet" || device === "desktop") filters.device = device;
    const country = q.get("f_country");
    if (country && (/^[A-Za-z]{2}$/.test(country) || country === "unknown")) filters.country = country === "unknown" ? country : country.toUpperCase();
    const channel = q.get("f_channel");
    if (channel && /^[a-z_]{2,20}$/.test(channel)) filters.channel = channel;
    // A link without filter params keeps whatever the base had (saved views start clean).
    view.filters = q.has("f_device") || q.has("f_country") || q.has("f_channel") ? filters : base.filters;
    return view;
}

/** The query string for a view, without the leading "?"; empty when everything is default. */
export function buildQuery(view: ViewState): string {
    const q = new URLSearchParams();
    if (view.selection.kind === "custom") {
        q.set("from", view.selection.from);
        q.set("to", view.selection.to);
    } else if (view.selection.key !== DEFAULT_PRESET) {
        q.set("r", view.selection.key);
    }
    if (view.zone !== DEFAULT_VIEW.zone) q.set("tz", view.zone);
    if (view.clock !== DEFAULT_VIEW.clock) q.set("clock", view.clock);
    if (view.density !== DEFAULT_VIEW.density) q.set("density", view.density);
    if (view.compare) q.set("cmp", "1");
    if (view.story) q.set("story", view.story);
    if (view.filters.device) q.set("f_device", view.filters.device);
    if (view.filters.country) q.set("f_country", view.filters.country);
    if (view.filters.channel) q.set("f_channel", view.filters.channel);
    return q.toString();
}
