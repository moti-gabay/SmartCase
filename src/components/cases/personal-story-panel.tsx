"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TRANSCRIPTION_STATUS_LABELS } from "@/lib/constants";
import type { TranscriptionStatus } from "@/types";
import { Play, Pause, Mic, FileText, Loader2, AlertTriangle } from "lucide-react";

// Staff-side view of the client's personal story: the written text, the voice
// recording, and whatever the transcription pipeline has produced so far.
//
// Playback hits /api/cases/[id]/story-audio, which 302s to a short-lived
// presigned GET — the R2 key is never exposed to the browser, and the session
// guard lives on that route (not on a portal token).
export function PersonalStoryPanel({
  caseId, personalStory, hasAudio, transcript, transcriptionStatus,
}: {
  caseId: string;
  personalStory?: string | null;
  hasAudio: boolean;
  transcript?: string | null;
  transcriptionStatus?: TranscriptionStatus | null;
}) {
  if (!personalStory && !hasAudio) return null;

  return (
    <div className="flex flex-col gap-3">
      {personalStory && (
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">סיפור אישי (כתוב)</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{personalStory}</p>
        </div>
      )}

      {hasAudio && (
        <>
          <AudioPlayer caseId={caseId} />
          <TranscriptBlock transcript={transcript} status={transcriptionStatus} />
        </>
      )}
    </div>
  );
}

// The transcript is the only part worth printing — a player is meaningless on
// paper, so it is print:hidden below while this block stays visible.
function TranscriptBlock({ transcript, status }: { transcript?: string | null; status?: TranscriptionStatus | null }) {
  if (transcript) {
    return (
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-1.5 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-slate-400" />
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">תמלול ההקלטה</p>
        </div>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{transcript}</p>
      </div>
    );
  }

  if (!status) return null;

  const failed = status === "FAILED";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium",
        failed ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-500"
      )}
    >
      {failed ? (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <Loader2 className={cn("h-3.5 w-3.5 shrink-0", status === "PROCESSING" && "animate-spin")} />
      )}
      {TRANSCRIPTION_STATUS_LABELS[status]}
    </div>
  );
}

const mmss = (seconds: number): string => {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

function AudioPlayer({ caseId }: { caseId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState(false);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError(true));
    else el.pause();
  };

  const seek = (value: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = value;
    setCurrent(value);
  };

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 print:hidden">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> טעינת ההקלטה נכשלה
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 print:hidden">
      <div className="mb-2 flex items-center gap-1.5">
        <Mic className="h-3.5 w-3.5 text-indigo-500" />
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">הקלטת הסיפור האישי</p>
      </div>

      {/* Transport runs LTR even in the RTL shell — a scrubber that fills
          right-to-left reads as broken to everyone, including Hebrew speakers. */}
      <div className="flex items-center gap-3" dir="ltr">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "השהיית ההקלטה" : "הפעלת ההקלטה"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white hover:bg-indigo-700"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={current}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="מיקום בהקלטה"
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-slate-200 accent-indigo-600"
        />

        <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-500">
          {mmss(current)} / {mmss(duration)}
        </span>
      </div>

      <audio
        ref={audioRef}
        // The route 302s to a presigned URL; preload="metadata" fetches just
        // enough to render the duration without pulling the whole recording.
        src={`/api/cases/${caseId}/story-audio`}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }}
        onError={() => setError(true)}
        className="hidden"
      />
    </div>
  );
}
