"use client";

// Dictation for the assistant composer: MediaRecorder capture → POST to
// /api/ai/chat/transcribe → onTranscript(text). State transitions live in the
// pure voiceReducer; this hook only owns the browser side effects.
import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  VOICE_ERRORS,
  VOICE_INITIAL,
  SPEECH_RMS_THRESHOLD,
  VOICE_MAX_DURATION_MS,
  classifyMediaError,
  rms,
  voiceReducer,
} from "@/lib/ai/voice-input";

export function useVoiceInput(onTranscript: (text: string) => void) {
  const [state, dispatch] = useReducer(voiceReducer, VOICE_INITIAL);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped on cancel/unmount so late async callbacks from a discarded
  // session can tell they are stale and bail.
  const sessionRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const supported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const releaseMic = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (meterRef.current) clearInterval(meterRef.current);
    meterRef.current = null;
    void audioCtxRef.current?.close();
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob, session: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const body = new FormData();
      body.append("audio", blob);
      const res = await fetch("/api/ai/chat/transcribe", { method: "POST", body, signal: controller.signal });
      const data = await res.json().catch(() => ({}));
      if (session !== sessionRef.current) return;
      if (!res.ok) {
        dispatch({ type: "FAILED", error: typeof data.error === "string" ? data.error : VOICE_ERRORS.failed });
        return;
      }
      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) {
        dispatch({ type: "FAILED", error: VOICE_ERRORS.empty });
        return;
      }
      dispatch({ type: "DONE" });
      onTranscriptRef.current(text);
    } catch {
      if (session === sessionRef.current) dispatch({ type: "FAILED", error: VOICE_ERRORS.failed });
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      dispatch({ type: "STOP" });
      recorder.stop(); // onstop releases the mic and uploads
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      dispatch({ type: "START" });
      dispatch({ type: "FAILED", error: VOICE_ERRORS.unsupported });
      return;
    }
    const session = ++sessionRef.current;
    dispatch({ type: "START" });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (session === sessionRef.current) dispatch(classifyMediaError((err as DOMException)?.name));
      return;
    }
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    streamRef.current = stream;

    // Track the loudest 100ms window; a clip that never crosses the speech
    // threshold is discarded client-side instead of being "transcribed".
    let peak = 0;
    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      audioCtxRef.current = ctx;
      meterRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        peak = Math.max(peak, rms(buf));
      }, 100);
    } catch {
      peak = Infinity; // no Web Audio — fail open and let the server decide
    }

    const recorder = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      releaseMic();
      if (session !== sessionRef.current) return;
      if (peak < SPEECH_RMS_THRESHOLD) {
        dispatch({ type: "FAILED", error: VOICE_ERRORS.empty });
        return;
      }
      void transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }), session);
    };
    recorderRef.current = recorder;
    recorder.start();
    dispatch({ type: "GRANTED" });
    timerRef.current = setTimeout(stop, VOICE_MAX_DURATION_MS);
  }, [supported, releaseMic, transcribe, stop]);

  const cancel = useCallback(() => {
    sessionRef.current++;
    abortRef.current?.abort();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    releaseMic();
    dispatch({ type: "CANCEL" });
  }, [releaseMic]);

  // Unmount (drawer close) must never leave the mic indicator on.
  useEffect(() => cancel, [cancel]);

  return { status: state.status, error: state.error, supported, start, stop, cancel };
}
