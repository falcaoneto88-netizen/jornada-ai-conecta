import { useEffect, useRef, useState } from "react";
import {
  INBOX_MEDIA_MAX_BYTES,
  inboxAttachmentSchema,
  type InboxAttachment,
} from "@/lib/commercial-agent/inbox-media";

export const MAX_MEDIA_BYTES = INBOX_MEDIA_MAX_BYTES;
export const MAX_RECORDING_SECONDS = 120;
type MediaMime = InboxAttachment["mimeType"];
export type { InboxAttachment };
export type MediaDraft = InboxAttachment & { url: string; size: number; kind: "image" | "audio" };
const TYPES: Record<string, { mime: MediaMime; extensions: string[] }> = {
  "image/jpeg": { mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  "image/png": { mime: "image/png", extensions: ["png"] },
  "image/gif": { mime: "image/gif", extensions: ["gif"] },
  "audio/mpeg": { mime: "audio/mpeg", extensions: ["mp3"] },
  "audio/mp3": { mime: "audio/mpeg", extensions: ["mp3"] },
  "audio/wav": { mime: "audio/wav", extensions: ["wav"] },
  "audio/x-wav": { mime: "audio/wav", extensions: ["wav"] },
  "audio/wave": { mime: "audio/wav", extensions: ["wav"] },
  "audio/ogg": { mime: "audio/ogg", extensions: ["ogg"] },
  "application/ogg": { mime: "audio/ogg", extensions: ["ogg"] },
  "audio/mp4": { mime: "audio/mp4", extensions: ["m4a"] },
  "audio/x-m4a": { mime: "audio/mp4", extensions: ["m4a"] },
  "audio/aac": { mime: "audio/aac", extensions: ["aac"] },
};

export function validateMediaFile(file: File): MediaMime {
  if (!inboxAttachmentSchema.shape.name.safeParse(file.name).success)
    throw new Error(
      "Use um nome de arquivo com até 180 caracteres, sem barras ou caracteres de controle.",
    );
  if (file.size === 0) throw new Error("O arquivo está vazio. Escolha outro arquivo.");
  if (file.size > MAX_MEDIA_BYTES) throw new Error("O anexo deve ter no máximo 5 MB.");
  const type = file.type.split(";")[0]!.toLowerCase();
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const match =
    TYPES[type] ??
    (type === "" ? Object.values(TYPES).find((t) => t.extensions.includes(extension)) : undefined);
  if (!match || !match.extensions.includes(extension))
    throw new Error("Use uma imagem JPG, PNG ou GIF, ou áudio MP3, WAV, OGG, M4A ou AAC.");
  return match.mime;
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result.split(",")[1] : null;
      if (value) resolve(value);
      else reject(new Error("Não foi possível ler o anexo. Escolha o arquivo novamente."));
    };
    reader.onerror = reader.onabort = () =>
      reject(new Error("Não foi possível ler o anexo. Escolha o arquivo novamente."));
    reader.readAsDataURL(file);
  });
}

/** Browser-only PCM WAV: mono / 16 kHz / 16-bit keeps a two-minute recording under 5 MiB. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return buffer;
}

async function recordingFile(blob: Blob): Promise<File> {
  const type = blob.type.split(";")[0];
  if (type === "audio/ogg") return new File([blob], "gravacao.ogg", { type });
  // WebM and generic recorder MP4 containers are not accepted by every connected channel.
  // Decode and convert locally; renaming the extension would not convert the actual bytes.
  if (typeof AudioContext === "undefined" || typeof OfflineAudioContext === "undefined")
    throw new Error("Este navegador não conseguiu preparar a gravação. Anexe um arquivo de áudio.");
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (
      !Number.isFinite(decoded.duration) ||
      decoded.duration <= 0 ||
      decoded.duration > MAX_RECORDING_SECONDS + 1
    )
      throw new Error("A gravação deve ter até 2 minutos. Grave novamente ou anexe um áudio.");
    const length = Math.min(Math.ceil(decoded.duration * 16000), MAX_RECORDING_SECONDS * 16000);
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return new File([encodeWav(rendered.getChannelData(0))], "gravacao.wav", { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

/** No network calls or persistence: drafts, microphone tracks and object URLs belong to one mounted conversation. */
export function useInboxMedia(onChange: () => void) {
  const [draft, setDraft] = useState<MediaDraft | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "permission" | "recording">("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const stateRef = useRef(state);
  const draftRef = useRef<MediaDraft | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = useRef(onChange);
  change.current = onChange;
  const updateState = (value: typeof state) => {
    stateRef.current = value;
    if (mounted.current) setState(value);
  };
  const stopTracks = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (timer.current) clearInterval(timer.current);
    if (deadline.current) clearTimeout(deadline.current);
    timer.current = deadline.current = null;
  };
  const clearDraft = () => {
    if (draftRef.current) URL.revokeObjectURL(draftRef.current.url);
    draftRef.current = null;
    if (mounted.current) setDraft(null);
  };
  const cancel = () => {
    generation.current++;
    const current = recorder.current;
    recorder.current = null;
    if (current) {
      current.onstop = current.ondataavailable = current.onerror = null;
      if (current.state !== "inactive") current.stop();
    }
    stopTracks();
    updateState("idle");
    if (mounted.current) {
      setSeconds(0);
      setError(null);
    }
  };
  const remove = () => {
    cancel();
    clearDraft();
    change.current();
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
      clearDraft();
    };
    // The component is remounted on every conversation or organisation change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function prepare(file: File, token: number) {
    const mimeType = validateMediaFile(file);
    const base64 = await readBase64(file);
    if (!mounted.current || token !== generation.current) return;
    if (!inboxAttachmentSchema.safeParse({ name: file.name, mimeType, base64 }).success)
      throw new Error("Não foi possível preparar o anexo. Escolha outro arquivo.");
    const next: MediaDraft = {
      name: file.name,
      mimeType,
      base64,
      size: file.size,
      kind: mimeType.startsWith("image/") ? "image" : "audio",
      url: URL.createObjectURL(file),
    };
    clearDraft();
    draftRef.current = next;
    setDraft(next);
    change.current();
  }
  async function select(file: File) {
    if (stateRef.current !== "idle") return;
    const token = ++generation.current;
    setError(null);
    updateState("loading");
    try {
      await prepare(file, token);
    } catch (e) {
      if (mounted.current && generation.current === token)
        setError(e instanceof Error ? e.message : "Não foi possível preparar o anexo.");
    } finally {
      if (mounted.current && generation.current === token) updateState("idle");
    }
  }
  function stop() {
    if (stateRef.current !== "recording") return;
    updateState("loading");
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
    stopTracks();
  }
  async function start() {
    if (stateRef.current !== "idle") return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microfone indisponível neste navegador. Você pode anexar um arquivo de áudio.");
      return;
    }
    const token = ++generation.current;
    setError(null);
    setSeconds(0);
    updateState("permission");
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || token !== generation.current) {
        acquired.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = acquired;
      const mimeType = [
        "audio/ogg;codecs=opus",
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const current = new MediaRecorder(acquired, mimeType ? { mimeType } : undefined);
      const startedAt = Date.now();
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.current = current;
      current.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          bytes += event.data.size;
        }
        if (bytes > MAX_MEDIA_BYTES && current.state !== "inactive") stop();
      };
      current.onerror = () => {
        if (!mounted.current || generation.current !== token) return;
        cancel();
        setError("Não foi possível gravar. Tente novamente ou anexe um arquivo de áudio.");
      };
      current.onstop = async () => {
        stopTracks();
        recorder.current = null;
        if (!mounted.current || generation.current !== token) return;
        updateState("loading");
        try {
          if (Date.now() - startedAt > (MAX_RECORDING_SECONDS + 1) * 1000)
            throw new Error("A gravação passou de 2 minutos. Grave um áudio mais curto.");
          if (bytes > MAX_MEDIA_BYTES)
            throw new Error("A gravação excedeu 5 MB. Grave um áudio mais curto.");
          const file = await recordingFile(
            new Blob(chunks, { type: current.mimeType || mimeType || "audio/webm" }),
          );
          if (mounted.current && generation.current === token) await prepare(file, token);
        } catch (e) {
          if (mounted.current && generation.current === token)
            setError(
              e instanceof Error
                ? e.message
                : "Não foi possível preparar a gravação. Anexe um arquivo de áudio.",
            );
        } finally {
          if (mounted.current && generation.current === token) updateState("idle");
        }
      };
      current.start(250);
      updateState("recording");
      timer.current = setInterval(() => {
        if (mounted.current)
          setSeconds(Math.min(MAX_RECORDING_SECONDS, Math.floor((Date.now() - startedAt) / 1000)));
      }, 250);
      deadline.current = setTimeout(stop, MAX_RECORDING_SECONDS * 1000);
    } catch {
      if (!mounted.current || generation.current !== token) return;
      cancel();
      setError(
        "Não foi possível acessar o microfone. Verifique a permissão ou anexe um arquivo de áudio.",
      );
    }
  }
  return {
    draft,
    state,
    error,
    seconds,
    select,
    start,
    stop,
    cancel,
    remove,
    clearAfterSend: () => {
      cancel();
      clearDraft();
    },
    isBusy: () => stateRef.current !== "idle",
    snapshot: (): InboxAttachment[] =>
      draftRef.current
        ? [
            {
              name: draftRef.current.name,
              mimeType: draftRef.current.mimeType,
              base64: draftRef.current.base64,
            },
          ]
        : [],
  };
}
