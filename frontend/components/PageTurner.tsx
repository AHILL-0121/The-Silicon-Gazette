"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";

type PageSpec = {
  id: string;
  label: string;
  subtitle?: string;
  content: ReactNode;
};

interface PageTurnerProps {
  pages: PageSpec[];
  initialPageId?: string;
}

function getHashPageId(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.hash.replace("#", "") || null;
}

export function PageTurner({ pages, initialPageId }: PageTurnerProps) {
  const [pageIndex, setPageIndex] = useState(() => {
    if (initialPageId) {
      const idx = pages.findIndex((p) => p.id === initialPageId);
      if (idx >= 0) return idx;
    }
    return 0;
  });

  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(true);
    const hashId = getHashPageId();
    if (hashId) {
      const idx = pages.findIndex((p) => p.id === hashId);
      if (idx >= 0) {
        setPageIndex(idx);
      }
    }
  }, [pages]);

  const [turnDirection, setTurnDirection] = useState<"next" | "prev">("next");
  const [isTurning, setIsTurning] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const bookRef = useRef<HTMLElement>(null);
  const tabListRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const totalPages = pages.length;
  const safeIndex = Math.min(Math.max(pageIndex, 0), Math.max(totalPages - 1, 0));
  const currentPage = pages[safeIndex];

  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < totalPages - 1;

  // Move the sliding tab indicator
  useEffect(() => {
    const tabList = tabListRef.current;
    const indicator = indicatorRef.current;
    if (!tabList || !indicator) return;

    const activeTab = tabList.querySelector<HTMLButtonElement>(".is-active");
    if (!activeTab) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      indicator.style.left = `${activeTab.offsetLeft}px`;
      indicator.style.width = `${activeTab.offsetWidth}px`;
    } else {
      gsap.to(indicator, {
        left: activeTab.offsetLeft,
        width: activeTab.offsetWidth,
        duration: 0.3,
        ease: "power2.inOut",
      });
    }
  }, [safeIndex]);

  // Sync URL hash + scroll to book top
  useEffect(() => {
    if (!isHydrated || !currentPage) return;
    const hashId = getHashPageId();

    // Only update url and scroll if we actually navigated via the buttons/tabs
    // Avoids wiping out the user's initial hash load and scrolling them down forcibly on refresh
    if (hashId !== currentPage.id) {
      const url = new URL(window.location.href);
      url.hash = currentPage.id;
      window.history.replaceState(null, "", url.toString());

      if (bookRef.current) {
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        bookRef.current.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
      }
    }
  }, [safeIndex, currentPage, isHydrated]);

  const goToIndex = useCallback(
    (nextIndex: number, direction: "next" | "prev") => {
      if (nextIndex === safeIndex || nextIndex < 0 || nextIndex >= totalPages) return;

      // 3D page-turn animation
      const panel = bookRef.current?.querySelector(".book-page-inner");
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (panel && !reduced) {
        gsap.fromTo(
          panel,
          {
            rotateY: direction === "next" ? 0 : 0,
            opacity: 1,
            transformOrigin: direction === "next" ? "left center" : "right center",
          },
          {
            rotateY: direction === "next" ? -15 : 15,
            opacity: 0,
            duration: 0.22,
            ease: "power2.in",
            onComplete: () => {
              setTurnDirection(direction);
              setPageIndex(nextIndex);
              setIsTurning(true);
            },
          }
        );
      } else {
        setTurnDirection(direction);
        setPageIndex(nextIndex);
        setIsTurning(true);
      }
    },
    [safeIndex, totalPages]
  );

  // Animate new page in
  useEffect(() => {
    if (!isTurning) return;
    const panel = bookRef.current?.querySelector(".book-page-inner");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (panel && !reduced) {
      gsap.fromTo(
        panel,
        { rotateY: turnDirection === "next" ? 15 : -15, opacity: 0 },
        {
          rotateY: 0,
          opacity: 1,
          duration: 0.28,
          ease: "power2.out",
          onComplete: () => setIsTurning(false),
        }
      );
    } else {
      const timer = window.setTimeout(() => setIsTurning(false), 80);
      return () => window.clearTimeout(timer);
    }
  }, [isTurning, safeIndex, turnDirection]);

  const goNext = useCallback(() => {
    if (canGoNext) goToIndex(safeIndex + 1, "next");
  }, [canGoNext, goToIndex, safeIndex]);

  const goPrev = useCallback(() => {
    if (canGoPrev) goToIndex(safeIndex - 1, "prev");
  }, [canGoPrev, goToIndex, safeIndex]);

  // hashchange → browser back/forward
  useEffect(() => {
    function onHashChange() {
      const hashId = getHashPageId();
      if (!hashId) return;
      const idx = pages.findIndex((p) => p.id === hashId);
      if (idx >= 0 && idx !== safeIndex) {
        goToIndex(idx, idx > safeIndex ? "next" : "prev");
      }
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [pages, safeIndex, goToIndex]);

  // Arrow key navigation
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "ArrowRight") goNext();
      if (event.key === "ArrowLeft") goPrev();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev]);

  function handleTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleTouchEnd(event: React.TouchEvent) {
    const start = touchStart.current;
    if (!start) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    touchStart.current = null;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) < Math.abs(deltaY)) return;
    if (deltaX < 0) goNext();
    else goPrev();
  }

  if (!currentPage) return null;

  return (
    <section className="edition-book" aria-label="Edition pages" ref={bookRef} id="edition-book">
      <div className="book-controls">
        <button
          id="book-btn-prev"
          className="book-btn"
          onClick={goPrev}
          type="button"
          disabled={!canGoPrev}
          aria-label="Previous page"
        >
          Prev Page
        </button>
        <div className="book-status" aria-live="polite" aria-atomic="true">
          <span className="book-label">{currentPage.label}</span>
          {currentPage.subtitle && (
            <span className="book-subtitle">{currentPage.subtitle}</span>
          )}
          <span className="book-count">Page {safeIndex + 1} of {totalPages}</span>
        </div>
        <button
          id="book-btn-next"
          className="book-btn"
          onClick={goNext}
          type="button"
          disabled={!canGoNext}
          aria-label="Next page"
        >
          Next Page
        </button>
      </div>

      {/* Tab list with sliding ink indicator */}
      <div className="page-tabs-wrap">
        <div
          className="page-tabs"
          role="tablist"
          aria-label="Page list"
          ref={tabListRef}
        >
          {pages.map((page, idx) => {
            const isActive = idx === safeIndex;
            return (
              <button
                className={`page-tab${isActive ? " is-active" : ""}`}
                key={page.id}
                id={`tab-${page.id}`}
                onClick={() => goToIndex(idx, idx > safeIndex ? "next" : "prev")}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${page.id}`}
              >
                {page.label}
              </button>
            );
          })}
          <span className="tab-indicator" ref={indicatorRef} aria-hidden="true" />
        </div>
      </div>

      <div
        className="book-viewport"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ perspective: "1200px" }}
      >
        <div
          className={`book-page${isTurning ? " is-turning" : ""}`}
          data-turn={turnDirection}
        >
          <div
            className="book-page-inner"
            id={`panel-${currentPage.id}`}
            role="tabpanel"
            aria-labelledby={`tab-${currentPage.id}`}
            tabIndex={0}
            style={{ transformStyle: "preserve-3d" }}
          >
            {currentPage.content}
          </div>
        </div>
        <div className="book-stack" aria-hidden="true" />
      </div>
    </section>
  );
}
