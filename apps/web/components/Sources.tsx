"use client";
import type { Citation } from "@bombot/shared";

export function Sources({ citations }: { citations: Citation[] }) {
  return (
    <aside className="sources" aria-label="מקורות">
      <h2>מקורות</h2>
      {citations.length === 0 ? (
        <p className="none">כשהתשובה תתבסס על חיפוש, המקורות יופיעו כאן עם קישור לכל אחד.</p>
      ) : (
        <ol>
          {citations.map((c) => (
            <li key={c.index} className="src">
              <span className="n">{c.index}</span>
              <div>
                <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title ?? c.url}</a>
                <div className="dom">{safeHost(c.url)}</div>
                {c.citedText && <q>{c.citedText.slice(0, 220)}{c.citedText.length > 220 ? "…" : ""}</q>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function safeHost(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}
