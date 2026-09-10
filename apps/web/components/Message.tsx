"use client";
import type { MessageView } from "@bombot/shared";
import { Markdown } from "./Markdown";

export interface LiveStatus {
  tools: { tool: "web_search" | "web_fetch"; input: string; ok?: boolean; count?: number }[];
  streaming: boolean;
  error?: string;
}

export function Message({ m, live }: { m: MessageView; live?: LiveStatus }) {
  if (m.role === "user") {
    return (
      <div className="msg msg-user">
        <div className="bubble">{m.text}</div>
        {m.attachments.length > 0 && (
          <div className="att">{m.attachments.map((a) => <span key={a.id}>{a.name}</span>)}</div>
        )}
      </div>
    );
  }
  const hasStatus = live && (live.tools.length > 0 || live.streaming);
  return (
    <div className="msg msg-assistant">
      {hasStatus && (
        <div className="status" aria-live="polite">
          {live!.streaming && !m.text && <span className="chip live"><span className="pulse" />{live!.tools.length ? "קורא מקורות" : "חושב"}</span>}
          {live!.tools.map((t, i) => (
            <span key={i} className={`chip ${t.ok ? "ok" : ""}`} title={t.input}>
              {t.tool === "web_search" ? "🔎 " : "📄 "}{t.input || (t.tool === "web_search" ? "חיפוש" : "קריאה")}{typeof t.count === "number" ? ` · ${t.count}` : ""}
            </span>
          ))}
        </div>
      )}
      {m.thinking && (
        <details className="thinking" open={live?.streaming && !m.text}>
          <summary>מהלך החשיבה</summary>
          <pre>{m.thinking}</pre>
        </details>
      )}
      {m.safety && <div className="safety">התשובה הוגבלה על ידי שכבת הבטיחות של Bombot.</div>}
      {live?.error && <div className="errbox">{live.error}</div>}
      <div className="bubble"><Markdown text={m.text} citations={m.citations} /></div>
      {m.usage && (
        <div className="usage">
          {m.usage.webSearchRequests > 0 ? `${m.usage.webSearchRequests} חיפושים · ` : ""}
          {m.usage.inputTokens + m.usage.cacheReadInputTokens} טוקנים נכנסים · {m.usage.outputTokens} יוצאים · ${m.usage.estimatedCostUsd.toFixed(4)}
        </div>
      )}
    </div>
  );
}
