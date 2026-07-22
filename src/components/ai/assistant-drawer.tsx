"use client";

// Global AI assistant: FAB (bottom-start, opposite the sidebar in RTL) opening
// a side drawer. Mounted once in the dashboard layout so it is available on
// every staff route.
import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Send, Sparkles, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatMarkdown } from "@/components/ai/chat-markdown";
import { useChatStream, type ChatMessage } from "@/components/ai/use-chat-stream";
import { useEscapeKey } from "@/hooks/use-escape-key";

// memo: only the actively-streaming message's content changes per SSE chunk —
// the array reference from setMessages changes every chunk, but unchanged
// messages keep the same object reference, so a memoized bubble skips
// re-render (and, for assistant bubbles, the markdown re-parse) entirely.
const MessageBubble = memo(function MessageBubble({ role, content }: Pick<ChatMessage, "role" | "content">) {
  if (role === "USER") {
    return (
      <div
        className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl bg-indigo-600 px-4 py-2 text-sm text-white"
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
        content === "" && "text-slate-400"
      )}
    >
      {content === "" ? <Loader2 className="my-1 h-4 w-4 animate-spin" /> : <ChatMarkdown content={content} />}
    </div>
  );
});

export function AssistantDrawer() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, status, toolActive, error, hydrate, send, stop, reset } = useChatStream();
  const listRef = useRef<HTMLDivElement>(null);
  const streaming = status === "streaming";

  useEffect(() => {
    if (open) hydrate();
  }, [open, hydrate]);

  useEscapeKey(open, () => setOpen(false));

  // Follow the stream: keep the newest content in view.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, toolActive, open]);

  const submit = () => {
    const text = input.trim();
    if (!text || streaming) return;
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
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
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
                <MessageBubble key={m.id} role={m.role} content={m.content} />
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
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  placeholder="כתוב שאלה..."
                  className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
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
                    disabled={!input.trim()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                    aria-label="שלח"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
