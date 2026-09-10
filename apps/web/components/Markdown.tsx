"use client";
import type { Citation } from "@bombot/shared";
import { Fragment, type ReactNode } from "react";

/**
 * Small, dependency-free renderer for the subset of Markdown the assistant is told to use:
 * paragraphs, headings (h2/h3), bold, inline code, fenced code, links, unordered/ordered lists, simple tables,
 * and [n] citation markers that link to the sources panel.
 */
export function Markdown({ text, citations }: { text: string; citations: Citation[] }) {
  const blocks = splitBlocks(text);
  return <div className="prose">{blocks.map((b, i) => <Fragment key={i}>{renderBlock(b, citations)}</Fragment>)}</div>;
}

type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "p"; text: string };

function splitBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) body.push(lines[i] ?? ""), i++;
      i++;
      out.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { out.push({ kind: "h", level: Math.min(h[1]!.length + 1, 4), text: h[2]! }); i++; continue; }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i] ?? "")) items.push((lines[i] ?? "").replace(/^\s*[-*•]\s+/, "")), i++;
      out.push({ kind: "ul", items }); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) items.push((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, "")), i++;
      out.push({ kind: "ol", items }); continue;
    }
    if (line.trim().startsWith("|") && (lines[i + 1] ?? "").match(/^\s*\|?\s*:?-{2,}/)) {
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|")) {
        const cells = (lines[i] ?? "").trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push({ kind: "table", rows }); continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !(lines[i] ?? "").startsWith("```") && !/^(#{1,6})\s/.test(lines[i] ?? "") && !/^\s*[-*•]\s+/.test(lines[i] ?? "") && !/^\s*\d+[.)]\s+/.test(lines[i] ?? "")) para.push(lines[i] ?? ""), i++;
    out.push({ kind: "p", text: para.join("\n") });
  }
  return out;
}

function renderBlock(b: Block, cites: Citation[]): ReactNode {
  switch (b.kind) {
    case "code": return <pre><code data-lang={b.lang}>{b.body}</code></pre>;
    case "h": { const Tag = (`h${b.level}`) as "h2" | "h3" | "h4"; return <Tag>{inline(b.text, cites)}</Tag>; }
    case "ul": return <ul>{b.items.map((it, i) => <li key={i}>{inline(it, cites)}</li>)}</ul>;
    case "ol": return <ol>{b.items.map((it, i) => <li key={i}>{inline(it, cites)}</li>)}</ol>;
    case "table": {
      const [head, ...body] = b.rows;
      return (
        <div style={{ overflowX: "auto" }}>
          <table>
            {head && <thead><tr>{head.map((c, i) => <th key={i}>{inline(c, cites)}</th>)}</tr></thead>}
            <tbody>{body.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c, cites)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    case "p": return <p>{inline(b.text, cites)}</p>;
  }
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\[(\d{1,2})\]|https?:\/\/[^\s<>)"']+)/g;

function inline(text: string, cites: Citation[]): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(withBreaks(text.slice(last, idx), key++));
    const tok = m[0];
    if (tok.startsWith("**")) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={key++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[") && m[2]) parts.push(<a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer">{tok.slice(1, tok.indexOf("]"))}</a>);
    else if (m[3]) {
      const n = Number(m[3]);
      const c = cites.find((x) => x.index === n);
      parts.push(c
        ? <a key={key++} className="cite" href={c.url} target="_blank" rel="noopener noreferrer" title={c.title ?? c.url}>{n}</a>
        : <span key={key++} className="cite" aria-label={`מקור ${n}`}>{n}</span>);
    } else parts.push(<a key={key++} href={tok} target="_blank" rel="noopener noreferrer">{tok}</a>);
    last = idx + tok.length;
  }
  if (last < text.length) parts.push(withBreaks(text.slice(last), key++));
  return parts;
}

function withBreaks(s: string, key: number): ReactNode {
  const lines = s.split("\n");
  if (lines.length === 1) return <Fragment key={key}>{s}</Fragment>;
  return <Fragment key={key}>{lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{l}</Fragment>)}</Fragment>;
}
