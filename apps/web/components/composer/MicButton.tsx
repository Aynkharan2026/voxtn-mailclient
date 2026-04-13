"use client";

import { useEffect, useRef, useState } from "react";

type Status =
  | { state: "idle" }
  | { state: "requesting" }
  | { state: "recording"; seconds: number }
  | { state: "processing" }
  | { state: "error"; message: string };

const MAX_SECONDS = 120;

type Props = {
  onTranscribed: (result: { subject: string; html: string }) => void;
  onError: (message: string) => void;
  submit: (formData: FormData) => Promise<
    | { ok: true; subject: string; html: string }
    | { ok: false; error: string }
  >;
  disabled?: boolean;
};

export function MicButton({ onTranscribed, onError, submit, disabled }: Props) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanup = () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  };

  useEffect(() => () => cleanup(), []);

  const start = async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      onError("microphone not available in this browser");
      return;
    }
    setStatus({ state: "requesting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = handleStop;
      recorder.start();
      recorderRef.current = recorder;
      setStatus({ state: "recording", seconds: 0 });

      tickRef.current = setInterval(() => {
        setStatus((prev) =>
          prev.state === "recording"
            ? { ...prev, seconds: prev.seconds + 1 }
            : prev,
        );
      }, 1000);

      autoStopRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
      }, MAX_SECONDS * 1000);
    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", message: msg });
      onError(msg);
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const handleStop = async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (autoStopRef.current) {
      clearTimeout(autoStopRef.current);
      autoStopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = null;

    if (chunks.length === 0) {
      setStatus({ state: "idle" });
      return;
    }
    const mime = chunks[0]?.type || "audio/webm";
    const blob = new Blob(chunks, { type: mime });

    setStatus({ state: "processing" });
    try {
      const fd = new FormData();
      const ext = mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
      fd.append("audio", blob, `voice.${ext}`);
      const res = await submit(fd);
      if (res.ok) {
        onTranscribed({ subject: res.subject, html: res.html });
        setStatus({ state: "idle" });
      } else {
        setStatus({ state: "error", message: res.error });
        onError(res.error);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", message: msg });
      onError(msg);
    }
  };

  const isRecording = status.state === "recording";
  const isBusy =
    status.state === "requesting" ||
    status.state === "recording" ||
    status.state === "processing";

  let label: string;
  let icon: string;
  if (status.state === "recording") {
    label = `Stop (${status.seconds}s)`;
    icon = "■";
  } else if (status.state === "processing") {
    label = "Transcribing…";
    icon = "…";
  } else if (status.state === "requesting") {
    label = "Allow mic…";
    icon = "🎤";
  } else {
    label = "Voice";
    icon = "🎤";
  }

  const cls = isRecording
    ? "px-3 py-2 rounded border border-red-500 text-red-600 bg-red-50 font-medium animate-pulse"
    : "px-3 py-2 rounded border border-gray-300 text-brand-navy hover:bg-gray-50 font-medium";

  return (
    <button
      type="button"
      onClick={isRecording ? stop : start}
      disabled={disabled || (isBusy && !isRecording)}
      className={`${cls} disabled:opacity-50 flex items-center gap-2 text-sm`}
      aria-label={label}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
