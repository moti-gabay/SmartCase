"use client";

// Client side of the assistant chat SSE protocol (see src/lib/ai/chat-protocol.ts
// for the wire format). fetch + reader instead of EventSource because the
// endpoint requires a POST body.
import { useCallback, useRef, useState } from "react";
import type { IntentStatus, ProposedActionIntent } from "@/lib/ai/tools/types";

export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  proposals?: ProposedActionIntent[];
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
    const appendProposal = (intent: ProposedActionIntent) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, proposals: [...(m.proposals ?? []), intent] } : m))
      );
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
          else if (event === "proposal") appendProposal(data as unknown as ProposedActionIntent);
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
      setMessages((prev) =>
        prev.filter((m) => m.id !== assistantId || m.content !== "" || !!m.proposals?.length)
      );
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const patchProposal = useCallback((intentId: string, patch: Partial<ProposedActionIntent>) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.proposals?.some((p) => p.intentId === intentId)
          ? { ...m, proposals: m.proposals.map((p) => (p.intentId === intentId ? { ...p, ...patch } : p)) }
          : m
      )
    );
  }, []);

  // Human-in-the-Loop decision on a proposal card. Only the intent id travels —
  // the server executes the params it persisted at proposal time.
  // Returns an error string for a fixable 400 (bad card input) — the card
  // stays PENDING and shows it inline; every other outcome is final.
  const decide = useCallback(
    async (
      intentId: string,
      decision: "APPROVE" | "CANCEL",
      humanInput?: Record<string, string>
    ): Promise<string | null> => {
      try {
        const res = await fetch("/api/ai/actions/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intentId, decision, humanInput }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 400 || res.status === 429) return data.error ?? "הנתונים שהוזנו אינם תקינים";
        const status: IntentStatus =
          data.status ?? (res.status === 410 ? "EXPIRED" : res.status === 403 ? "DENIED" : "FAILED");
        patchProposal(intentId, {
          status,
          resultMessage: data.message ?? data.error,
          entityHref: data.entityHref,
        });
        return null;
      } catch {
        return "שגיאת רשת — נסה שוב";
      }
    },
    [patchProposal]
  );

  // "שיחה חדשה": next send() creates a fresh conversation server-side.
  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationIdRef.current = null;
    setMessages([]);
    setError(null);
  }, []);

  // Live Voice Mode shares this thread: it reads/adopts the conversation id
  // and appends its committed transcript turns locally (no refetch).
  const getConversationId = useCallback(() => conversationIdRef.current, []);
  const setConversationId = useCallback((id: string) => {
    conversationIdRef.current = id;
  }, []);
  // Live Voice Mode proposals: shown immediately as a standalone card.
  const appendProposal = useCallback((intent: ProposedActionIntent) => {
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "ASSISTANT", content: "", proposals: [intent] },
    ]);
  }, []);
  const appendMessages = useCallback((turns: Omit<ChatMessage, "id">[]) => {
    setMessages((prev) => [...prev, ...turns.map((t) => ({ ...t, id: crypto.randomUUID() }))]);
  }, []);

  return {
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
  };
}
