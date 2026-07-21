"use client";

// Client side of the assistant chat SSE protocol (see src/lib/ai/chat-protocol.ts
// for the wire format). fetch + reader instead of EventSource because the
// endpoint requires a POST body.
import { useCallback, useRef, useState } from "react";

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
};

type ChatStatus = "idle" | "streaming";

type SseFrame = { event: string; data: Record<string, unknown> };

function* parseFrames(buffer: string): Generator<SseFrame> {
  for (const block of buffer.split("\n\n")) {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (!event || !data) continue; // heartbeats / partials
    try {
      yield { event, data: JSON.parse(data) };
    } catch {
      /* malformed frame — skip */
    }
  }
}

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [toolActive, setToolActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  // Load the user's rolling conversation once, on first drawer open.
  const hydrate = useCallback(async () => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    try {
      const res = await fetch("/api/ai/chat");
      if (!res.ok) {
        hydratedRef.current = false; // retry on next open
        return;
      }
      const data = await res.json();
      conversationIdRef.current = data.conversationId ?? null;
      setMessages(data.messages ?? []);
    } catch {
      hydratedRef.current = false; // transient failure — retry on next open
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message) return;
    setError(null);
    setStatus("streaming");
    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "USER", content: message },
      { id: assistantId, role: "ASSISTANT", content: "" },
    ]);
    const appendDelta = (delta: string) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
      );

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: conversationIdRef.current }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "אירעה שגיאה — נסה שוב");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Process only complete frames; keep the trailing partial in buffer.
        const lastBreak = buffer.lastIndexOf("\n\n");
        if (lastBreak === -1) continue;
        const complete = buffer.slice(0, lastBreak);
        buffer = buffer.slice(lastBreak + 2);
        for (const { event, data } of parseFrames(complete)) {
          if (event === "meta") conversationIdRef.current = String(data.conversationId);
          else if (event === "delta") appendDelta(String(data.text ?? ""));
          else if (event === "tool") setToolActive(data.status === "start");
          else if (event === "error") setError(String(data.message ?? "אירעה שגיאה"));
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setError(err instanceof Error ? err.message : "אירעה שגיאה — נסה שוב");
      }
    } finally {
      abortRef.current = null;
      setToolActive(false);
      setStatus("idle");
      // Drop the placeholder if nothing streamed (error / instant abort).
      setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content !== ""));
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // "שיחה חדשה": next send() creates a fresh conversation server-side.
  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = null;
    setMessages([]);
    setError(null);
  }, []);

  return { messages, status, toolActive, error, hydrate, send, stop, reset };
}
