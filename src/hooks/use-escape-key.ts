"use client";

import { useEffect, useRef } from "react";

// Shared by every dismissible overlay (mobile nav drawer, AI assistant panel)
// so the Escape-closes-it keydown listener lives in one place. `onEscape` is
// read via a ref so callers can pass a fresh inline closure each render
// without re-subscribing the listener on every keystroke/render.
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onEscapeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
