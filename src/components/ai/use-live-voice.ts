"use client";

// Live Voice Mode: full-duplex speech with the assistant over a browser-direct
// Gemini Live WebSocket (ephemeral token from /api/ai/live/token). Tool calls
// are relayed to /api/ai/live/tool; transcripts are committed to
// /api/ai/live/commit at each turnComplete. State transitions live in the pure
// liveReducer; this hook only owns the browser side effects.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai/web";
import {
  LIVE_ERRORS,
  LIVE_INITIAL,
  LIVE_INPUT_RATE,
  LIVE_MAX_SESSION_MS,
  LIVE_OUTPUT_RATE,
  appendFragment,
  isLiveActive,
  liveReducer,
  pcm16ToFloat,
  type LiveTurn,
} from "@/lib/ai/live-protocol";
import { SPEECH_RMS_THRESHOLD, classifyMediaError } from "@/lib/ai/voice-input";

// Local speech indicator only — server VAD is authoritative for barge-in.
const QUIET_AFTER_MS = 700;
// Small lead so the first chunk of a response isn't scheduled in the past.
const PLAYBACK_LEAD_S = 0.02;

type ToolRecord = { name: string; ok: boolean; ms: number };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64Pcm(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

export function useLiveVoice(opts: {
  getConversationId: () => string | null;
  onConversationId: (id: string) => void;
  onCommitted: (turns: LiveTurn[]) => void;
}) {
  const [state, dispatch] = useReducer(liveReducer, LIVE_INITIAL);
  // Uncommitted transcript of the current exchange, shown as provisional bubbles.
  const [pending, setPending] = useState<LiveTurn[]>([]);
  const [analyser, setAnalyser] = useState<{
    input: AnalyserNode;
    output: AnalyserNode;
  } | null>(null);

  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  }, [opts]);

  const sessionRef = useRef<Session | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inCtxRef = useRef<AudioContext | null>(null);
  const outCtxRef = useRef<AudioContext | null>(null);
  const outAnalyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const nextStartRef = useRef(0);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const turnsRef = useRef<LiveTurn[]>([]);
  const sealsRef = useRef<string[]>([]);
  const toolsRef = useRef<ToolRecord[]>([]);
  // Bumped on teardown so late callbacks from a discarded session bail.
  const genRef = useRef(0);

  const flushPlayback = useCallback(() => {
    for (const src of sourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    sourcesRef.current.clear();
    nextStartRef.current = 0;
  }, []);

  // Persist the accumulated turns. keepalive/sendBeacon so a hang-up or
  // page unload still lands the last exchange.
  const commit = useCallback((final: boolean) => {
    const conversationId = conversationIdRef.current;
    const turns = turnsRef.current.filter((t) => t.text.trim());
    if (!conversationId || turns.length === 0) return;
    const body = JSON.stringify({
      conversationId,
      turns,
      piiSeals: sealsRef.current,
      toolCalls: toolsRef.current,
    });
    turnsRef.current = [];
    sealsRef.current = [];
    toolsRef.current = [];
    setPending([]);
    optsRef.current.onCommitted(turns);
    if (final && navigator.sendBeacon?.("/api/ai/live/commit", body)) return;
    void fetch("/api/ai/live/commit", {
      method: "POST",
      body,
      keepalive: true,
    }).catch(() => {});
  }, []);

  const teardown = useCallback(() => {
    genRef.current++;
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    if (capTimerRef.current) clearTimeout(capTimerRef.current);
    quietTimerRef.current = capTimerRef.current = null;
    try {
      sessionRef.current?.close();
    } catch {
      /* already closed */
    }
    sessionRef.current = null;
    flushPlayback();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void inCtxRef.current?.close();
    void outCtxRef.current?.close();
    inCtxRef.current = outCtxRef.current = null;
    outAnalyserRef.current = null;
    setAnalyser(null);
    commit(true);
  }, [commit, flushPlayback]);

  const hangUp = useCallback(() => {
    dispatch({ type: "HANGUP" });
    teardown();
    dispatch({ type: "CLOSED" });
  }, [teardown]);

  const fail = useCallback(
    (error: string) => {
      dispatch({ type: "FAILED", error });
      teardown();
    },
    [teardown]
  );

  const playChunk = useCallback((b64: string) => {
    const ctx = outCtxRef.current;
    if (!ctx || !outAnalyserRef.current) return;
    const samples = pcm16ToFloat(fromBase64Pcm(b64));
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, LIVE_OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(outAnalyserRef.current);
    // Gapless: each chunk starts exactly where the previous one ends.
    const startAt = Math.max(ctx.currentTime + PLAYBACK_LEAD_S, nextStartRef.current);
    src.start(startAt);
    nextStartRef.current = startAt + buffer.duration;
    sourcesRef.current.add(src);
    src.onended = () => {
      sourcesRef.current.delete(src);
      if (sourcesRef.current.size === 0) dispatch({ type: "QUIET" });
    };
    dispatch({ type: "AI_AUDIO" });
  }, []);

  const runTools = useCallback(async (msg: LiveServerMessage, gen: number) => {
    const calls = msg.toolCall?.functionCalls ?? [];
    const functionResponses = await Promise.all(
      calls.map(async (call) => {
        let response: Record<string, unknown> = { error: "השאילתה נכשלה" };
        try {
          const res = await fetch("/api/ai/live/tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: call.name, args: call.args ?? {} }),
          });
          const data = await res.json();
          if (res.ok) {
            response = data.result;
            sealsRef.current.push(data.piiSeal);
            toolsRef.current.push({
              name: call.name ?? "",
              ok: data.ok,
              ms: data.ms,
            });
          }
        } catch {
          /* answered with the generic error so the model's turn can complete */
        }
        return { id: call.id, name: call.name, response };
      })
    );
    if (gen === genRef.current) sessionRef.current?.sendToolResponse({ functionResponses });
  }, []);

  const onMessage = useCallback(
    (msg: LiveServerMessage, gen: number) => {
      if (gen !== genRef.current) return;
      if (msg.toolCall) void runTools(msg, gen);
      const content = msg.serverContent;
      if (msg.goAway) return fail(LIVE_ERRORS.dropped);
      if (!content) return;
      if (content.interrupted) {
        // Barge-in: server VAD heard the user — silence the model immediately.
        flushPlayback();
        dispatch({ type: "USER_SPEECH" });
      }
      const pushFragment = (role: LiveTurn["role"], text?: string) => {
        if (!text) return;
        turnsRef.current = appendFragment(turnsRef.current, role, text);
        setPending(turnsRef.current);
      };
      pushFragment("USER", content.inputTranscription?.text);
      pushFragment("ASSISTANT", content.outputTranscription?.text);
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) playChunk(part.inlineData.data);
      }
      if (content.turnComplete) commit(false);
    },
    [commit, fail, flushPlayback, playChunk, runTools]
  );

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      dispatch({ type: "START" });
      return fail(LIVE_ERRORS.unsupported);
    }
    dispatch({ type: "START" });
    const gen = ++genRef.current;
    turnsRef.current = [];
    sealsRef.current = [];
    toolsRef.current = [];
    setPending([]);

    let stream: MediaStream;
    try {
      // Echo cancellation is load-bearing: without it the model hears its own
      // playback and barges in on itself.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (err) {
      const event = classifyMediaError(err instanceof DOMException ? err.name : undefined);
      if (event.type === "DENIED") dispatch(event);
      else fail(LIVE_ERRORS.connect);
      return;
    }
    if (gen !== genRef.current) return stream.getTracks().forEach((t) => t.stop());
    streamRef.current = stream;

    try {
      const res = await fetch("/api/ai/live/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: optsRef.current.getConversationId(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : LIVE_ERRORS.connect);
      if (gen !== genRef.current) return;
      conversationIdRef.current = data.conversationId;
      optsRef.current.onConversationId(data.conversationId);

      const inCtx = new AudioContext({ sampleRate: LIVE_INPUT_RATE });
      const outCtx = new AudioContext({ sampleRate: LIVE_OUTPUT_RATE });
      inCtxRef.current = inCtx;
      outCtxRef.current = outCtx;
      await inCtx.audioWorklet.addModule("/worklets/pcm-capture.js");
      const inAnalyser = new AnalyserNode(inCtx, { fftSize: 64 });
      const outAnalyser = new AnalyserNode(outCtx, { fftSize: 64 });
      outAnalyser.connect(outCtx.destination);
      outAnalyserRef.current = outAnalyser;

      const ai = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const session = await ai.live.connect({
        model: data.model,
        callbacks: {
          onopen: () => {},
          onmessage: (msg) => onMessage(msg, gen),
          onerror: () => gen === genRef.current && fail(LIVE_ERRORS.connect),
          onclose: () => {
            if (gen !== genRef.current) return;
            dispatch({ type: "CLOSED" });
            teardown();
          },
        },
      });
      if (gen !== genRef.current) return session.close();
      sessionRef.current = session;

      const source = inCtx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(inCtx, "pcm-capture");
      source.connect(inAnalyser);
      source.connect(worklet);
      worklet.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        if (gen !== genRef.current) return;
        sessionRef.current?.sendRealtimeInput({
          audio: {
            data: toBase64(e.data.pcm),
            mimeType: `audio/pcm;rate=${LIVE_INPUT_RATE}`,
          },
        });
        if (e.data.rms > SPEECH_RMS_THRESHOLD) {
          dispatch({ type: "USER_SPEECH" });
          if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
          quietTimerRef.current = setTimeout(() => {
            if (sourcesRef.current.size === 0) dispatch({ type: "QUIET" });
          }, QUIET_AFTER_MS);
        }
      };
      setAnalyser({ input: inAnalyser, output: outAnalyser });
      capTimerRef.current = setTimeout(() => fail(LIVE_ERRORS.limit), LIVE_MAX_SESSION_MS);
      dispatch({ type: "OPENED" });
    } catch (err) {
      if (gen === genRef.current) fail(err instanceof Error && err.message ? err.message : LIVE_ERRORS.connect);
    }
  }, [fail, onMessage, teardown]);

  // Unmount / navigation away: close the socket and land the last exchange.
  const activeRef = useRef(false);
  useEffect(() => {
    activeRef.current = isLiveActive(state.status);
  }, [state.status]);
  useEffect(() => {
    const onHide = () => activeRef.current && teardown();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      if (activeRef.current) teardown();
    };
  }, [teardown]);

  return {
    status: state.status,
    error: state.error,
    pending,
    analyser,
    start,
    hangUp,
  };
}
