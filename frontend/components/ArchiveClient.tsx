"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import gsap from "gsap";
import type { EditionSummary } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/edition-view";

interface ArchiveClientProps {
    editions: EditionSummary[];
}

export function ArchiveClient({ editions }: ArchiveClientProps) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<string>("All");

    useEffect(() => {
        // Staggered reveal animation on mount
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced) {
            gsap.fromTo(
                ".archive-group",
                { opacity: 0, y: 15 },
                { opacity: 1, y: 0, duration: 0.6, stagger: 0.1, ease: "power2.out" }
            );
        }
    }, []);

    const { grouped, categories } = useMemo(() => {
        // 1. Collect unique categories for the filter
        const cats = Array.from(new Set(editions.map((e) => e.category))).sort();

        // 2. Filter the editions based on query and category
        const q = query.toLowerCase().trim();
        const filtered = editions.filter((e) => {
            if (category !== "All" && e.category !== category) return false;
            if (!q) return true;
            return (
                e.date.includes(q) ||
                e.title.toLowerCase().includes(q) ||
                e.category.toLowerCase().includes(q)
            );
        });

        // 3. Group by YYYY-MM
        const groups = new Map<string, EditionSummary[]>();
        for (const ed of filtered) {
            const monthRegex = /^(\d{4}-\d{2})/;
            const match = ed.date.match(monthRegex);
            const monthPrefix = match ? match[1] : "Unknown";

            const list = groups.get(monthPrefix) ?? [];
            list.push(ed);
            groups.set(monthPrefix, list);
        }

        // Sort groups descending
        const sortedGroups = Array.from(groups.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([month, items]) => {
                // Format YYYY-MM as "Month YYYY"
                let groupLabel = month;
                if (month !== "Unknown") {
                    const [yy, mm] = month.split("-");
                    const dateObj = new Date(parseInt(yy, 10), parseInt(mm, 10) - 1);
                    groupLabel = dateObj.toLocaleDateString("en-US", { month: "long", year: "numeric" });
                }
                return { label: groupLabel, month, items };
            });

        return { grouped: sortedGroups, categories: ["All", ...cats] };
    }, [editions, query, category]);

    return (
        <>
            <div className="archive-controls">
                <label className="sr-only" htmlFor="archive-search">Search archive</label>
                <input
                    id="archive-search"
                    type="search"
                    className="archive-search"
                    placeholder="Search editions by headline or date..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
                <label className="sr-only" htmlFor="archive-category">Filter by category</label>
                <select
                    id="archive-category"
                    className="archive-select"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                >
                    {categories.map((c) => (
                        <option key={c} value={c}>{c === "All" ? "All Categories" : (CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] || c)}</option>
                    ))}
                </select>
            </div>

            {grouped.length === 0 ? (
                <p className="err-body" style={{ marginTop: "24px" }}>
                    No editions found matching &ldquo;{query}&rdquo;.
                </p>
            ) : (
                <div className="archive-grid">
                    {grouped.map((group) => (
                        <div key={group.month} className="archive-group">
                            <h2 className="archive-group-label">{group.label}</h2>
                            <table className="archive-table" aria-label={`Editions for ${group.label}`}>
                                <thead>
                                    <tr className="archive-head">
                                        <th scope="col">Date</th>
                                        <th scope="col">Issue</th>
                                        <th scope="col">Lead Headline</th>
                                        <th scope="col">Category</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {group.items.map((edition) => (
                                        <tr className="archive-row" key={edition.date}>
                                            <td>
                                                <Link href={`/gazette/${edition.date}`} className="archive-link">
                                                    {edition.date}
                                                </Link>
                                            </td>
                                            <td>#{edition.issue_num}</td>
                                            <td>
                                                <Link href={`/gazette/${edition.date}`} className="archive-link">
                                                    {edition.title}
                                                </Link>
                                            </td>
                                            <td>{CATEGORY_LABELS[edition.category as keyof typeof CATEGORY_LABELS] || edition.category}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
