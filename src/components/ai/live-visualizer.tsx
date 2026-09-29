"use client";

// Live Voice Mode level meter: 5 bars driven by an AnalyserNode (mic while the
// user talks, playback while the assistant does; created with fftSize 64 in
// use-live-voice). Writes bar heights straight to the DOM from rAF — no React
// state, so no re-render per frame.
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const BARS = 5;

export function LiveVisualizer({ analyser, tone }: { analyser?: AnalyserNode; tone: "indigo" | "violet" }) {
  const barsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bars = barsRef.current?.children;
    if (!analyser || !bars) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BARS; i++) {
        const level = data[i * 3 + 1] / 255;
        (bars[i] as HTMLElement).style.transform = `scaleY(${Math.max(0.15, level)})`;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <div ref={barsRef} className="flex h-8 items-center gap-1" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-full w-1.5 origin-center scale-y-[0.15] rounded-full transition-transform duration-75",
            tone === "violet" ? "bg-violet-500" : "bg-indigo-500"
          )}
        />
      ))}
    </div>
  );
}
