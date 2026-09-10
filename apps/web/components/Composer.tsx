"use client";
import { MODE_LABELS, type AttachmentRef, type Mode } from "@bombot/shared";
import { useRef, useState } from "react";
import { uploadFile } from "@/lib/api";

export interface ComposerProps {
  disabled: boolean;
  onSend(text: string, opts: { mode: Mode; think: boolean; attachmentIds: string[] }): void;
  onStop(): void;
}

export function Composer({ disabled, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("balanced");
  const [think, setThink] = useState(false);
  const [pending, setPending] = useState<AttachmentRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t, { mode, think, attachmentIds: pending.map((p) => p.id) });
    setText(""); setPending([]);
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true); setUploadError(null);
    try {
      const refs = await Promise.all(Array.from(files).map(uploadFile));
      setPending((p) => [...p, ...refs]);
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="box">
          {pending.length > 0 && (
            <div className="pending">
              {pending.map((p) => (
                <span key={p.id}>{p.name}<button type="button" aria-label={`הסר ${p.name}`} onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))}>×</button></span>
              ))}
            </div>
          )}
          <textarea
            id="composer-text"
            ref={taRef}
            value={text}
            rows={1}
            placeholder="שאלו כל דבר. Bombot יחפש ברשת כשצריך ויצרף מקורות."
            aria-label="הודעה"
            onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${e.target.scrollHeight}px`; }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          />
          <div className="controls">
            <div className="seg" role="group" aria-label="רמת מאמץ">
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{MODE_LABELS[m].he}</button>
              ))}
            </div>
            <button type="button" className="toggle" aria-pressed={think} onClick={() => setThink((v) => !v)} title="הצגת מהלך החשיבה של המודל">
              💭 Think
            </button>
            <button type="button" className="iconbtn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "מעלה…" : "📎 קובץ"}
            </button>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,.pdf,.txt,.md,.csv" onChange={(e) => onFiles(e.target.files)} />
            {disabled
              ? <button type="button" className="send" onClick={onStop}>עצור</button>
              : <button type="button" className="send" onClick={submit} disabled={!text.trim()}>שלח</button>}
          </div>
        </div>
        {uploadError && <div className="errbox">{uploadError}</div>}
        <div className="hint">Enter לשליחה, Shift+Enter לשורה חדשה. Bombot יכול לטעות. בדקו את המקורות.</div>
      </div>
    </div>
  );
}
