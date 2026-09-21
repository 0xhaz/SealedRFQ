"use client";

import { useEffect, useState } from "react";

/**
 * Jump list for the RFQ form, which has grown past one screen.
 *
 * Posting an RFQ sets terms, a timetable, a rubric and a basket, and every one of them is fixed
 * on-chain the moment it opens — so a buyer needs to be able to go back and check a section before
 * committing, not scroll and hope. The highlight follows the section actually in view rather than
 * the last link clicked, because the two stop agreeing as soon as anyone scrolls by hand.
 */
export type NavSection = { id: string; label: string };

export function FormNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        // The most visible section wins; near the foot of a page several are on screen at once and
        // picking the first would stick on whichever happens to be topmost.
        let best = "";
        let ratio = 0;
        for (const [id, r] of seen) {
          if (r > ratio) {
            ratio = r;
            best = id;
          }
        }
        if (best) setActive(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1], rootMargin: "-80px 0px -40% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="form-nav" aria-label="Sections of this form">
      <div className="form-nav-title">On this page</div>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>
            <a className={active === s.id ? "is-active" : ""} href={`#${s.id}`}>
              {s.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
