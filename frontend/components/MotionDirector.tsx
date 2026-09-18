"use client";

import { useEffect } from "react";

import { loadGsap } from "./motion";

/**
 * Scroll-driven motion for the page, declared with data attributes and run by
 * GSAP ScrollTrigger on top of Lenis smooth scrolling:
 *
 *   data-anim="words"        headline words rise out of their masks on enter
 *   data-anim="rule"         a rule draws across as it scrolls into view (scrubbed)
 *   data-anim="scrub-words"  words ink in one by one as you read down (scrubbed)
 *   data-anim="parallax"     drifts at data-speed (and fades to data-fade) as its
 *                            [data-parallax-root] scrolls from data-start to off-screen
 *   data-anim="count"        number counts up to its value on enter
 *   data-anim="bg-drift"     background pattern drifts slower than the page
 *
 * Everything lives inside gsap.matchMedia, so reduced motion reverts it all
 * (and switching the OS setting mid-visit reverts or restores it live).
 * Elements already on screen when the page loads are never hidden, so there
 * is no flash of missing content, and nothing is hidden when JS doesn't run.
 */
export function MotionDirector() {
  useEffect(() => {
    let disposed = false;
    let revert: (() => void) | undefined;
    void loadGsap().then(({ gsap, ScrollTrigger }) => {
      if (disposed) return;
      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const fold = window.innerHeight * 0.92;
        const belowFold = (el: Element) => el.getBoundingClientRect().top > fold;
        // matchMedia revert restores tweened properties, not text content.
        const restoreText: Array<() => void> = [];

        gsap.utils
          .toArray<HTMLElement>('[data-anim="words"]')
          .filter(belowFold)
          .forEach((el) => {
            gsap.from(el.querySelectorAll(".sw-i"), {
              yPercent: 110,
              rotate: 4,
              duration: 1,
              ease: "power4.out",
              stagger: 0.06,
              scrollTrigger: { trigger: el, start: "top 88%", once: true }
            });
          });

        gsap.utils.toArray<HTMLElement>('[data-anim="rule"]').forEach((el) => {
          gsap.fromTo(
            el,
            { scaleX: 0, transformOrigin: "left center" },
            { scaleX: 1, ease: "none", scrollTrigger: { trigger: el, start: "top 98%", end: "top 62%", scrub: 0.6 } }
          );
        });

        gsap.utils
          .toArray<HTMLElement>('[data-anim="scrub-words"]')
          .filter(belowFold)
          .forEach((el) => {
            gsap.fromTo(
              el.querySelectorAll(".sw-i"),
              { opacity: 0.14 },
              {
                opacity: 1,
                ease: "none",
                stagger: 0.08,
                scrollTrigger: { trigger: el, start: "top 85%", end: "bottom 50%", scrub: 0.5 }
              }
            );
          });

        gsap.utils.toArray<HTMLElement>('[data-anim="parallax"]').forEach((el) => {
          const speed = Number(el.dataset.speed ?? 0.3);
          const fade = el.dataset.fade === undefined ? 1 : Number(el.dataset.fade);
          gsap.to(el, {
            yPercent: speed * 100,
            opacity: fade,
            ease: "none",
            scrollTrigger: {
              trigger: el.closest("[data-parallax-root]") ?? el,
              start: el.dataset.start ?? "top top",
              end: "bottom top",
              scrub: true
            }
          });
        });

        gsap.utils
          .toArray<HTMLElement>('[data-anim="count"]')
          .filter(belowFold)
          .forEach((el) => {
            const target = Number(el.dataset.value ?? el.textContent);
            if (!Number.isFinite(target)) return;
            const state = { value: 0 };
            el.textContent = "0";
            gsap.to(state, {
              value: target,
              duration: 1.4,
              ease: "power2.out",
              scrollTrigger: { trigger: el, start: "top 90%", once: true },
              onUpdate: () => {
                el.textContent = String(Math.round(state.value));
              },
              onComplete: () => {
                el.textContent = String(target);
              }
            });
            restoreText.push(() => {
              el.textContent = String(target);
            });
          });

        gsap.utils.toArray<HTMLElement>('[data-anim="bg-drift"]').forEach((el) => {
          gsap.fromTo(
            el,
            { backgroundPositionY: "0px" },
            {
              backgroundPositionY: "-160px",
              ease: "none",
              scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true }
            }
          );
        });

        return () => restoreText.forEach((restore) => restore());
      });

      // Web fonts change line heights after load; re-measure trigger positions.
      document.fonts?.ready.then(() => {
        if (!disposed) ScrollTrigger.refresh();
      });
      revert = () => mm.revert();
    });

    return () => {
      disposed = true;
      revert?.();
    };
  }, []);

  return null;
}
