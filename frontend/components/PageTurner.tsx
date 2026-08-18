"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

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

export function PageTurner({ pages, initialPageId }: PageTurnerProps) {
  const initialIndex = useMemo(() => {
    if (!initialPageId) return 0;
    const foundIndex = pages.findIndex((page) => page.id === initialPageId);
    return foundIndex >= 0 ? foundIndex : 0;
  }, [initialPageId, pages]);

  const [pageIndex, setPageIndex] = useState(initialIndex);
  const [turnDirection, setTurnDirection] = useState<"next" | "prev">("next");
  const [isTurning, setIsTurning] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const totalPages = pages.length;
  const safeIndex = Math.min(Math.max(pageIndex, 0), Math.max(totalPages - 1, 0));
  const currentPage = pages[safeIndex];

  const canGoPrev = safeIndex > 0;
  const canGoNext = safeIndex < totalPages - 1;

  const goToIndex = useCallback(
    (nextIndex: number, direction: "next" | "prev") => {
      if (nextIndex === safeIndex || nextIndex < 0 || nextIndex >= totalPages) return;
      setTurnDirection(direction);
      setPageIndex(nextIndex);
      setIsTurning(true);
    },
    [safeIndex, totalPages]
  );

  const goNext = useCallback(() => {
    if (canGoNext) {
      goToIndex(safeIndex + 1, "next");
    }
  }, [canGoNext, goToIndex, safeIndex]);

  const goPrev = useCallback(() => {
    if (canGoPrev) {
      goToIndex(safeIndex - 1, "prev");
    }
  }, [canGoPrev, goToIndex, safeIndex]);

  useEffect(() => {
    if (!isTurning) return;
    const timer = window.setTimeout(() => setIsTurning(false), 520);
    return () => window.clearTimeout(timer);
  }, [isTurning, safeIndex]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        goNext();
      }
      if (event.key === "ArrowLeft") {
        goPrev();
      }
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
    if (deltaX < 0) {
      goNext();
    } else {
      goPrev();
    }
  }

  if (!currentPage) {
    return null;
  }

  return (
    <section className="edition-book" aria-label="Edition pages">
      <div className="book-controls">
        <button className="book-btn" onClick={goPrev} type="button" disabled={!canGoPrev}>
          Prev Page
        </button>
        <div className="book-status" aria-live="polite">
          <span className="book-label">{currentPage.label}</span>
          {currentPage.subtitle ? <span className="book-subtitle">{currentPage.subtitle}</span> : null}
          <span className="book-count">
            Page {safeIndex + 1} of {totalPages}
          </span>
        </div>
        <button className="book-btn" onClick={goNext} type="button" disabled={!canGoNext}>
          Next Page
        </button>
      </div>

      <div className="page-tabs" role="tablist" aria-label="Page list">
        {pages.map((page, idx) => {
          const isActive = idx === safeIndex;
          return (
            <button
              className={`page-tab${isActive ? " is-active" : ""}`}
              key={page.id}
              onClick={() => goToIndex(idx, idx > safeIndex ? "next" : "prev")}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`page-${page.id}`}
            >
              {page.label}
            </button>
          );
        })}
      </div>

      <div className="book-viewport" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div
          className={`book-page${isTurning ? " is-turning" : ""}`}
          data-turn={turnDirection}
          role="group"
          aria-roledescription="page"
          aria-label={currentPage.label}
        >
          <div className="book-page-inner" id={`page-${currentPage.id}`}>
            {currentPage.content}
          </div>
        </div>
        <div className="book-stack" aria-hidden="true" />
      </div>
    </section>
  );
}
