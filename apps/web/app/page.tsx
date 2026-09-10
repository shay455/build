"use client";
import type { Citation, ConversationView, MessageView, Mode } from "@bombot/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Composer } from "@/components/Composer";
import { Message, type LiveStatus } from "@/components/Message";
import { Sources } from "@/components/Sources";
import { createConversation, deleteConversation, getConversation, listConversations, sendMessage } from "@/lib/api";

type ConvSummary = Omit<ConversationView, "messages">;

const SUGGESTIONS = [
  "מה החדשות המרכזיות בישראל היום?",
  "האם נכון ש… ? בדוק את הטענה עם מקורות",
  "הסבר לי בקצרה מה זה Grok Bot של xAI",
  "השווה בין שלושת המודלים המובילים של AI כרגע",
];

export default function Page() {
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [current, setCurrent] = useState<ConversationView | null>(null);
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const refreshList = useCallback(async () => setConvs(await listConversations()), []);
  useEffect(() => { void refreshList(); }, [refreshList]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [current?.messages.length, live, current?.messages[current.messages.length - 1]?.text]);

  const open = async (id: string) => { const c = await getConversation(id); if (c) setCurrent(c); };
  const startNew = () => { setCurrent(null); setLive(null); };

  const patchLast = (fn: (m: MessageView) => MessageView) =>
    setCurrent((c) => {
      if (!c) return c;
      const msgs = c.messages.slice();
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return c;
      msgs[msgs.length - 1] = fn(last);
      return { ...c, messages: msgs };
    });

  const onSend = async (text: string, opts: { mode: Mode; think: boolean; attachmentIds: string[] }) => {
    let conv = current;
    if (!conv) { conv = await createConversation(); setCurrent(conv); }
    const convId = conv.id;
    const now = new Date().toISOString();
    const optimisticUser: MessageView = { id: `tmp-u-${Date.now()}`, conversationId: convId, role: "user", text, thinking: null, citations: [], attachments: [], usage: null, safety: null, createdAt: now };
    const draft: MessageView = { id: `tmp-a-${Date.now()}`, conversationId: convId, role: "assistant", text: "", thinking: null, citations: [], attachments: [], usage: null, safety: null, createdAt: now };
    setCurrent((c) => c ? { ...c, messages: [...c.messages, optimisticUser, draft] } : c);
    setLive({ tools: [], streaming: true });
    setStreamingId(draft.id);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      for await (const ev of sendMessage(convId, { text, ...opts }, ac.signal)) {
        switch (ev.type) {
          case "message_start": patchLast((m) => ({ ...m, id: ev.messageId })); setStreamingId(ev.messageId); break;
          case "thinking_delta": patchLast((m) => ({ ...m, thinking: (m.thinking ?? "") + ev.text })); break;
          case "text_delta": patchLast((m) => ({ ...m, text: m.text + ev.text })); break;
          case "citation": patchLast((m) => ({ ...m, citations: [...m.citations, ev.citation] })); break;
          case "tool_start": setLive((l) => l ? { ...l, tools: [...l.tools, { tool: ev.tool, input: ev.input }] } : l); break;
          case "tool_result": setLive((l) => {
            if (!l) return l;
            const tools = l.tools.slice();
            const i = tools.map((t) => t.tool === ev.tool && t.ok === undefined).lastIndexOf(true);
            if (i >= 0) tools[i] = { ...tools[i]!, ok: ev.ok, count: ev.resultCount };
            else tools.push({ tool: ev.tool, input: "", ok: ev.ok, count: ev.resultCount });
            return { ...l, tools };
          }); break;
          case "safety": patchLast((m) => ({ ...m, safety: ev.outcome })); break;
          case "usage": patchLast((m) => ({ ...m, usage: ev.usage })); break;
          case "done": patchLast(() => ev.message); break;
          case "error": setLive((l) => l ? { ...l, error: ev.message } : { tools: [], streaming: false, error: ev.message }); break;
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setLive((l) => ({ tools: l?.tools ?? [], streaming: false, error: "החיבור לשרת נכשל." }));
    } finally {
      setLive((l) => l ? { ...l, streaming: false } : l);
      setStreamingId(null);
      abortRef.current = null;
      void refreshList();
    }
  };

  const lastAssistant = [...(current?.messages ?? [])].reverse().find((m) => m.role === "assistant");
  const citations: Citation[] = lastAssistant?.citations ?? [];

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="שיחות">
        <div className="brand"><b>Bombot</b><span>alpha</span></div>
        <button className="newchat" onClick={startNew}>+ שיחה חדשה</button>
        <ul className="convlist">
          {convs.map((c) => (
            <li key={c.id}>
              <button aria-current={current?.id === c.id} onClick={() => open(c.id)} onDoubleClick={async () => { if (confirm("למחוק את השיחה?")) { await deleteConversation(c.id); if (current?.id === c.id) startNew(); void refreshList(); } }} title="לחיצה כפולה למחיקה">
                {c.title || "שיחה ללא כותרת"}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <main className="main">
        <div className="thread" ref={threadRef}>
          <div className="thread-inner">
            {!current || current.messages.length === 0 ? (
              <div className="empty">
                <h1>מה קורה עכשיו?</h1>
                <p>Bombot עונה עם חיפוש חי ומצרף מקור לכל טענה. שאלו על חדשות, בדקו טענה, או העלו קובץ.</p>
                <div className="suggest">
                  {SUGGESTIONS.map((s) => <button key={s} onClick={() => onSend(s, { mode: "balanced", think: false, attachmentIds: [] })}>{s}</button>)}
                </div>
              </div>
            ) : (
              current.messages.map((m) => <Message key={m.id} m={m} live={m.id === streamingId || (live && m.id === lastAssistant?.id) ? live ?? undefined : undefined} />)
            )}
          </div>
        </div>
        <Composer disabled={streamingId !== null} onSend={onSend} onStop={() => abortRef.current?.abort()} />
      </main>

      <Sources citations={citations} />
    </div>
  );
}
