"use client";

// Global AI assistant: FAB (bottom-start, opposite the sidebar in RTL) opening
// a side drawer. Mounted once in the dashboard layout so it is available on
// every staff route.
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AudioLines, Loader2, Mic, MicOff, PhoneOff, Plus, Send, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "@/components/ai/chat-markdown";
import { ActionCard } from "@/components/ai/action-card";
import type { ProposedActionIntent } from "@/lib/ai/tools/types";
import { useChatStream, type ChatMessage } from "@/components/ai/use-chat-stream";
import { useVoiceInput } from "@/components/ai/use-voice-input";
import { useLiveVoice } from "@/components/ai/use-live-voice";
import { LiveVisualizer } from "@/components/ai/live-visualizer";
import { isLiveActive, type LiveStatus, type LiveTurn } from "@/lib/ai/live-protocol";
import { useEscapeKey } from "@/hooks/use-escape-key";

// memo: only the actively-streaming message's content changes per SSE chunk —
// the array reference from setMessages changes every chunk, but unchanged
// messages keep the same object reference, so a memoized bubble skips
// re-render (and, for assistant bubbles, the markdown re-parse) entirely.
const LIVE_STATUS_LABELS: Partial<Record<LiveStatus, string>> = {
  CONNECTING: "מתחבר...",
  LIVE: "מחובר — אפשר לדבר",
  USER_SPEAKING: "מקשיב לך...",
  AI_SPEAKING: "העוזר מדבר",
  CLOSING: "מנתק...",
};

const MessageBubble = memo(function MessageBubble({
  role,
  content,
  provisional,
}: Pick<ChatMessage, "role" | "content"> & { provisional?: boolean }) {
  if (role === "USER") {
    return (
      <div
        className={cn(
          "max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white",
          provisional && "opacity-60"
        )}
        dir="auto"
      >
        {content}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "max-w-[85%] self-start rounded-2xl border border-slate-200 bg-white px-4 py-2",
        content === "" && "text-slate-400",
        provisional && "opacity-60"
      )}
    >
      {content === "" ? <Loader2 className="my-1 h-4 w-4 animate-spin" /> : <ChatMarkdown content={content} />}
    </div>
  );
});

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const {
    messages,
    status,
    toolActive,
    error,
    hydrate,
    send,
    stop,
    decide,
    reset,
    getConversationId,
    setConversationId,
    appendMessages,
    appendProposal,
  } = useChatStream();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streaming = status === "streaming";
  // Dictation only fills the textarea — the agent reviews and sends as usual,
  // so the transcript goes through the chat route's maskPii like typed text.
  const voice = useVoiceInput((text) => {
    setInput((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    inputRef.current?.focus();
  });
  const voiceBusy = voice.status === "LISTENING" || voice.status === "PROCESSING";
  const cancelVoice = voice.cancel;
  // Live Voice Mode shares the chat thread: committed transcript turns are
  // appended locally; persistence (maskPii) happens in /api/ai/live/commit.
  const live = useLiveVoice({
    getConversationId,
    onConversationId: setConversationId,
    onCommitted: useCallback(
      (turns: LiveTurn[]) => appendMessages(turns.map((t) => ({ role: t.role, content: t.text }))),
      [appendMessages]
    ),
    onProposal: appendProposal,
  });
  const liveOn = isLiveActive(live.status) || live.status === "CLOSING";
  const hangUp = live.hangUp;

  // The drawer stays mounted when closed, so closing (incl. Esc) must discard
  // an in-flight recording / live session and release the mic explicitly.
  useEffect(() => {
    if (!open) {
      cancelVoice();
      hangUp();
    }
  }, [open, cancelVoice, hangUp]);

  useEffect(() => {
    if (open) hydrate();
  }, [open, hydrate]);

  useEscapeKey(open, () => setOpen(false));

  // Follow the stream: keep the newest content in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, toolActive, open, live.pending]);

  // "תיקון": retire the current proposal and hand the composer back so the
  // user can dictate or type the correction; the model then re-proposes.
  // In Live Voice Mode the composer is replaced by the visualizer, so the
  // correction is simply spoken; the card is still retired by a click here.
  const refine = useCallback(
    (intent: ProposedActionIntent) => {
      void decide(intent.intentId, "CANCEL");
      if (liveOn) return;
      setInput((prev) => prev || `תיקון להצעה "${intent.summaryHebrew}": `);
      inputRef.current?.focus();
    },
    [decide, liveOn]
  );

  const submit = () => {
    const text = input.trim();
    if (!text || streaming || voiceBusy) return;
    setInput("");
    send(text);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 end-6 z-40 flex h-13 w-13 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg transition-colors hover:bg-violet-700"
        aria-label="פתח את עוזר SmartCase"
      >
        <Sparkles className="h-6 w-6" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-slate-900/40" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 end-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                  <Sparkles className="h-4 w-4" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900">עוזר SmartCase</h2>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={reset}
                  disabled={liveOn}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                >
                  <Plus className="h-3.5 w-3.5" />
                  שיחה חדשה
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
                  aria-label="סגור"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <div className="m-auto max-w-xs text-center text-sm text-slate-400">
                  שאל אותי על נתוני המערכת (&quot;כמה תיקים באיחור?&quot;) או איך לבצע פעולה
                  (&quot;איפה מפיקים קישור פורטל?&quot;)
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className="contents">
                  {(m.content !== "" || !m.proposals?.length) && <MessageBubble role={m.role} content={m.content} />}
                  {m.proposals?.map((p) => (
                    <ActionCard key={p.intentId} intent={p} onDecide={decide} onRefine={refine} />
                  ))}
                </div>
              ))}
              {live.pending.map((t, i) => (
                <MessageBubble key={`live-${i}`} role={t.role} content={t.text} provisional />
              ))}
              {toolActive && (
                <div className="flex items-center gap-1.5 self-start rounded-full bg-violet-50 px-3 py-1 text-xs text-violet-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  בודק נתונים...
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-slate-200 p-3">
              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              {voice.error && <p className="mb-2 text-xs text-red-600">{voice.error}</p>}
              {live.error && <p className="mb-2 text-xs text-red-600">{live.error}</p>}
              {liveOn ? (
                <div className="flex items-center gap-3">
                  <LiveVisualizer
                    analyser={live.status === "AI_SPEAKING" ? live.analyser?.output : live.analyser?.input}
                    tone={live.status === "AI_SPEAKING" ? "violet" : "indigo"}
                  />
                  <span className="flex-1 text-xs text-slate-600" aria-live="polite">
                    {LIVE_STATUS_LABELS[live.status]}
                  </span>
                  <button
                    onClick={live.hangUp}
                    disabled={live.status === "CLOSING"}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-sm text-white hover:bg-red-700 disabled:opacity-40"
                  >
                    <PhoneOff className="h-4 w-4" />
                    נתק
                  </button>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <textarea
                    ref={inputRef}
                    dir="auto"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    rows={2}
                    placeholder={voice.status === "LISTENING" ? "מקליט..." : "כתוב שאלה..."}
                    className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  />
                  <button
                    onClick={live.start}
                    disabled={streaming || voiceBusy || voice.status === "REQUESTING_PERMISSIONS"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-40"
                    aria-label="מצב שיחה קולית"
                    title="מצב שיחה קולית"
                  >
                    <AudioLines className="h-4 w-4" />
                  </button>
                  <button
                    onClick={voice.status === "LISTENING" ? voice.stop : voice.start}
                    disabled={streaming || voice.status === "PROCESSING" || voice.status === "REQUESTING_PERMISSIONS"}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg disabled:opacity-40",
                      voice.status === "LISTENING"
                        ? "animate-pulse bg-red-600 text-white hover:bg-red-700"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    )}
                    aria-label={voice.status === "LISTENING" ? "עצור הקלטה" : "הקלטת שאלה"}
                    title={voice.status === "PERMISSION_DENIED" ? (voice.error ?? undefined) : undefined}
                  >
                    {voice.status === "PROCESSING" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : voice.status === "PERMISSION_DENIED" ? (
                      <MicOff className="h-4 w-4" />
                    ) : (
                      <Mic className="h-4 w-4" />
                    )}
                  </button>
                  {streaming ? (
                    <button
                      onClick={stop}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
                      aria-label="עצור"
                    >
                      <Square className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={submit}
                      disabled={!input.trim() || voiceBusy}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                      aria-label="שלח"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
