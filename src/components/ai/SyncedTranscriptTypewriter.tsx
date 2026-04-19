import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import GlobalState from "../GlobalState";

interface TranscriptionSegment {
  id: number;
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

interface Transcription {
  segments: TranscriptionSegment[];
}

interface SyncedTranscriptTypewriterProps {
  transcription?: Transcription;
  audioUrl?: string;        // blob: ObjectURL (NOT data:)
  diaryEntry?: string;      // original diary text with proper line breaks; used as the source of truth for displayed characters
  onFinished?: () => void;  // called once when audio ends and all chars are revealed
}

export interface SyncedTranscriptTypewriterRef {
  reset: () => void;
}

interface CharData {
  char: string;
  t: number; // reveal time in seconds
}

function waitCanPlay(el: HTMLAudioElement) {
  return new Promise<void>((resolve) => {
    if (el.readyState >= 2) return resolve(); // HAVE_CURRENT_DATA
    const on = () => { el.removeEventListener("canplay", on); resolve(); };
    el.addEventListener("canplay", on, { once: true });
  });
}

const SyncedTranscriptTypewriter = forwardRef<SyncedTranscriptTypewriterRef, SyncedTranscriptTypewriterProps>(
  ({ transcription, audioUrl, diaryEntry, onFinished }, ref) => {

    const { noted } = GlobalState();

    const audio = useRef<HTMLAudioElement | null>(null);
    const rafId = useRef<number | null>(null);

    const timedCharsRef = useRef<CharData[]>([]);
    const idxRef = useRef<number>(0);
    const textRef = useRef<string>("");
    const onFinishedRef = useRef(onFinished);
    onFinishedRef.current = onFinished;

    const [displayedText, setDisplayedText] = useState("");
    const [needUserGesture, setNeedUserGesture] = useState(false);

    useImperativeHandle(ref, () => ({
      reset() {
        stopLoopAndAudio();
        idxRef.current = 0;
        textRef.current = "";
        setDisplayedText("");
        setNeedUserGesture(false);
      }
    }));

    useEffect(() => {
      timedCharsRef.current = [];
      idxRef.current = 0;
      textRef.current = "";
      setDisplayedText("");

      if (!transcription || !transcription.segments?.length) return;

      // 1) Build a flat list of timed characters from transcription segments.
      // Each character within a segment is given an interpolated reveal time.
      const segChars: CharData[] = [];
      transcription.segments.forEach((seg) => {
        const start = Math.max(0, seg.start ?? 0);
        const end = Math.max(start, seg.end ?? start);
        const duration = end - start;
        // Keep a single space between words; do NOT trim so we preserve gaps between segments.
        const text = (seg.text ?? "").replace(/\s+/g, " ");

        if (!text) return;

        const arr = Array.from(text);
        const len = arr.length;
        if (len === 1) {
          segChars.push({ char: arr[0], t: start });
          return;
        }
        for (let i = 0; i < len; i++) {
          const r = i / (len - 1);
          const t = start + duration * r;
          segChars.push({ char: arr[i], t });
        }
      });

      segChars.sort((a, b) => a.t - b.t);

      // 2) Align the original diaryEntry (source of truth for text + line breaks)
      //    to the transcribed segment timings. Each non-whitespace diary char
      //    inherits the reveal time of the nearest matching transcribed char.
      //    Whitespace (including "\n\n" paragraph breaks) inherits the previous
      //    timing so paragraph breaks appear right after the prior word.
      if (!diaryEntry || diaryEntry.length === 0) {
        // No diary text available; fall back to raw segment chars.
        timedCharsRef.current = segChars;
        return;
      }

      const norm = (c: string) => c.toLowerCase();
      const isWS = (c: string) => /\s/.test(c);

      const diaryChars = Array.from(diaryEntry);
      const aligned: CharData[] = [];
      let segIdx = 0;
      let lastT = segChars[0]?.t ?? 0;
      const LOOKAHEAD = 12;

      for (let i = 0; i < diaryChars.length; i++) {
        const c = diaryChars[i];

        if (isWS(c)) {
          aligned.push({ char: c, t: lastT });
          continue;
        }

        // Look ahead in the segment stream for a matching non-whitespace char.
        let foundIdx = -1;
        let scanned = 0;
        for (let j = segIdx; j < segChars.length && scanned < LOOKAHEAD; j++) {
          const sc = segChars[j];
          if (isWS(sc.char)) continue;
          scanned++;
          if (norm(sc.char) === norm(c)) {
            foundIdx = j;
            break;
          }
        }

        if (foundIdx >= 0) {
          lastT = segChars[foundIdx].t;
          segIdx = foundIdx + 1;
        }
        // If no match found, keep lastT and don't advance segIdx (diary char
        // is likely punctuation or text missing from the transcription).

        aligned.push({ char: c, t: lastT });
      }

      timedCharsRef.current = aligned;
    }, [transcription, diaryEntry]);

    useEffect(() => {
      if (!audioUrl) return;

      if (!audio.current) {
        audio.current = new Audio();
        audio.current.preload = "auto";
        audio.current.crossOrigin = "anonymous";
        audio.current.loop = false;
        audio.current.volume = 0.5;
      }

      if (!audioUrl.startsWith("blob:")) {
        console.error("[SyncedTranscriptTypewriter] audioUrl must be a blob: URL. Got:", audioUrl);
        return;
      }

      audio.current.src = audioUrl;
      audio.current.load();
    }, [audioUrl]);

    useEffect(() => {

      const el = audio.current;
      const haveChars = timedCharsRef.current.length > 0;
      if (!noted || !el || !audioUrl || !haveChars) {
        stopLoopAndAudio();
        return;
      }

      let canceled = false;
      const OFFSET = 0.20;
      let lastCommit = 0;

      const loop = (ts: number) => {
        if (canceled) return;

        const t = el.currentTime;
        const arr = timedCharsRef.current;
        let advanced = false;
        while (idxRef.current < arr.length) {
          const next = arr[idxRef.current];
          if (t >= next.t - OFFSET || el.ended) {
            textRef.current += next.char;
            idxRef.current += 1;
            advanced = true;
          } else {
            break;
          }
        }

        if (advanced && ts - lastCommit > 15) {
          setDisplayedText(textRef.current);
          lastCommit = ts;
        }

        if (idxRef.current >= arr.length && el.ended) {
          setDisplayedText(textRef.current);
          onFinishedRef.current?.();
          return;
        }

        rafId.current = requestAnimationFrame(loop);
      };

      (async () => {
        try {
          await waitCanPlay(el);
          await el.play().catch(() => {
            setNeedUserGesture(true);
          });
          if (!canceled) rafId.current = requestAnimationFrame(loop);
        } catch {
          setNeedUserGesture(true);
        }
      })();

      return () => {
        canceled = true;
        if (rafId.current) {
          cancelAnimationFrame(rafId.current);
          rafId.current = null;
        }
      };
    }, [noted, audioUrl, transcription]);

    useEffect(() => {
      if (!noted) {
        stopLoopAndAudio();
        setDisplayedText("");
        textRef.current = "";
        idxRef.current = 0;
      }
    }, [noted]);

    function stopLoopAndAudio() {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      if (audio.current) {
        try {
          audio.current.pause();
          audio.current.currentTime = 0;
        } catch { }
      }
    }

    async function handleUserStart() {
      if (!audio.current) return;
      setNeedUserGesture(false);
      try {
        await waitCanPlay(audio.current);
        await audio.current.play();
      } catch {
        setNeedUserGesture(true);
      }
    }

    return (
      <div style={{ position: "relative" }}>
        <pre style={{ whiteSpace: "pre-wrap" }}>{displayedText}</pre>
      </div>
    );
  }
);

SyncedTranscriptTypewriter.displayName = "SyncedTranscriptTypewriter";

export default SyncedTranscriptTypewriter;

