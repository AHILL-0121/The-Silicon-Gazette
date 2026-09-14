"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface CommandEntry {
    id: string;
    label: string;
    sublabel?: string;
    href: string;
    category: "story" | "section" | "repo" | "nav";
}

interface CommandPaletteProps {
    entries: CommandEntry[];
}

export function CommandPalette({ entries }: CommandPaletteProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeIdx, setActiveIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const router = useRouter();

    const filtered = query.trim()
        ? entries.filter(
            (e) =>
                e.label.toLowerCase().includes(query.toLowerCase()) ||
                e.sublabel?.toLowerCase().includes(query.toLowerCase())
        )
        : entries.slice(0, 12);

    // ⌘K / Ctrl+K or "/" to open
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            const tag = (event.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;

            if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || event.key === "/") {
                event.preventDefault();
                setOpen(true);
            }
            if (event.key === "Escape") {
                setOpen(false);
                setQuery("");
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
            setActiveIdx(0);
        }
    }, [open]);

    useEffect(() => {
        setActiveIdx(0);
    }, [query]);

    function handleKeyDown(event: React.KeyboardEvent) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
        } else if (event.key === "Enter") {
            const entry = filtered[activeIdx];
            if (entry) {
                navigate(entry.href);
            }
        } else if (event.key === "Escape") {
            setOpen(false);
            setQuery("");
        }
    }

    // Scroll active item into view
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const item = list.children[activeIdx] as HTMLElement | undefined;
        item?.scrollIntoView({ block: "nearest" });
    }, [activeIdx]);

    function navigate(href: string) {
        setOpen(false);
        setQuery("");
        router.push(href);
    }

    function categoryIcon(cat: CommandEntry["category"]) {
        if (cat === "story") return "📰";
        if (cat === "section") return "📑";
        if (cat === "repo") return "🔗";
        return "⬡";
    }

    if (!open) {
        return (
            <button
                className="cmd-trigger"
                onClick={() => setOpen(true)}
                type="button"
                aria-label="Open command palette (⌘K)"
                title="Search stories & sections (⌘K or /)"
            >
                <span className="cmd-trigger__icon">⌘</span>
                <span className="cmd-trigger__label">Search</span>
                <kbd className="cmd-trigger__kbd">⌘K</kbd>
            </button>
        );
    }

    return (
        <div
            className="cmd-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    setOpen(false);
                    setQuery("");
                }
            }}
            role="dialog"
            aria-label="Command palette"
            aria-modal="true"
        >
            <div className="cmd-modal">
                <div className="cmd-input-wrap">
                    <span className="cmd-input-icon" aria-hidden="true">⌕</span>
                    <input
                        ref={inputRef}
                        className="cmd-input"
                        type="text"
                        placeholder="Search stories, sections, repos…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        aria-label="Search"
                        aria-autocomplete="list"
                        aria-controls="cmd-list"
                        aria-activedescendant={filtered[activeIdx] ? `cmd-item-${filtered[activeIdx].id}` : undefined}
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <kbd className="cmd-esc-hint" onClick={() => { setOpen(false); setQuery(""); }}>ESC</kbd>
                </div>

                <ul
                    className="cmd-list"
                    id="cmd-list"
                    role="listbox"
                    ref={listRef}
                    aria-label="Search results"
                >
                    {filtered.length === 0 && (
                        <li className="cmd-empty" role="option" aria-selected="false">
                            No results for <strong>{query}</strong>
                        </li>
                    )}
                    {filtered.map((entry, idx) => (
                        <li
                            key={entry.id}
                            id={`cmd-item-${entry.id}`}
                            className={`cmd-item${idx === activeIdx ? " is-active" : ""}`}
                            role="option"
                            aria-selected={idx === activeIdx}
                            onClick={() => navigate(entry.href)}
                            onMouseEnter={() => setActiveIdx(idx)}
                        >
                            <span className="cmd-item__icon" aria-hidden="true">{categoryIcon(entry.category)}</span>
                            <span className="cmd-item__text">
                                <span className="cmd-item__label">{entry.label}</span>
                                {entry.sublabel && (
                                    <span className="cmd-item__sublabel">{entry.sublabel}</span>
                                )}
                            </span>
                            <span className="cmd-item__cat" aria-hidden="true">{entry.category}</span>
                        </li>
                    ))}
                </ul>
                <div className="cmd-footer" aria-hidden="true">
                    <span><kbd>↑↓</kbd> Navigate</span>
                    <span><kbd>↵</kbd> Open</span>
                    <span><kbd>Esc</kbd> Close</span>
                </div>
            </div>
        </div>
    );
}

export type { CommandEntry };
