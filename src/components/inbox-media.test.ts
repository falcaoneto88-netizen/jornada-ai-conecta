// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeWav, MAX_MEDIA_BYTES, useInboxMedia, validateMediaFile } from "./inbox-media";

const stopTrack = vi.fn();
const getUserMedia = vi.fn();
const fakeStream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
class Recorder {
  static latest: Recorder;
  static isTypeSupported = vi.fn((mime: string) => mime.startsWith("audio/ogg"));
  mimeType = "audio/ogg;codecs=opus";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => Promise<void> | void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_stream: MediaStream, options?: { mimeType: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    Recorder.latest = this;
  }
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["OggS local recording"], { type: this.mimeType }) });
    void this.onstop?.();
  });
}
beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:local-media"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  getUserMedia.mockReset().mockResolvedValue(fakeStream);
  stopTrack.mockReset();
  vi.stubGlobal("MediaRecorder", Recorder);
  Recorder.isTypeSupported.mockImplementation((mime: string) => mime.startsWith("audio/ogg"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  ["foto.jpg", "image/jpeg", "image/jpeg"],
  ["foto.png", "image/png", "image/png"],
  ["foto.gif", "image/gif", "image/gif"],
  ["voz.mp3", "audio/mp3", "audio/mpeg"],
  ["voz.wav", "audio/x-wav", "audio/wav"],
  ["voz.ogg", "audio/ogg;codecs=opus", "audio/ogg"],
  ["voz.m4a", "audio/x-m4a", "audio/mp4"],
  ["voz.aac", "audio/aac", "audio/aac"],
  ["voz.MP3", "", "audio/mpeg"],
])("valida arquivo local %s e normaliza tipo", (name, mime, canonical) => {
  expect(validateMediaFile(new File(["bytes"], name, { type: mime }))).toBe(canonical);
});
it("rejeita vazio, extensão conflitante, SVG, MIME desconhecido e >5MiB", () => {
  for (const file of [
    new File([], "foto.png", { type: "image/png" }),
    new File(["x"], "foto.exe", { type: "image/png" }),
    new File(["x"], "foto.svg", { type: "image/svg+xml" }),
    new File(["x"], "audio.mp3", { type: "application/octet-stream" }),
    new File([new Uint8Array(MAX_MEDIA_BYTES + 1)], "grande.png", { type: "image/png" }),
  ])
    expect(() => validateMediaFile(file)).toThrow();
  expect(
    validateMediaFile(
      new File([new Uint8Array(MAX_MEDIA_BYTES)], "limite.png", { type: "image/png" }),
    ),
  ).toBe("image/png");
});
it("grava, para tracks, permite ouvir e só cria rascunho local", async () => {
  const changed = vi.fn();
  const { result } = renderHook(() => useInboxMedia(changed));
  await act(async () => result.current.start());
  expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  expect(result.current.state).toBe("recording");
  expect(changed).not.toHaveBeenCalled();
  act(() => result.current.stop());
  await waitFor(() => expect(result.current.draft?.kind).toBe("audio"));
  expect(result.current.snapshot()).toEqual([
    { name: "gravacao.ogg", mimeType: "audio/ogg", base64: btoa("OggS local recording") },
  ]);
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(result.current.state).toBe("idle");
  expect(changed).toHaveBeenCalledTimes(1);
  act(() => result.current.remove());
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local-media");
  expect(result.current.snapshot()).toEqual([]);
});
it("dois cliques em gravar pedem microfone uma vez; cancelar descarta chunks", async () => {
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => {
    void result.current.start();
    void result.current.start();
  });
  expect(getUserMedia).toHaveBeenCalledTimes(1);
  act(() => result.current.cancel());
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(result.current.draft).toBeNull();
  expect(result.current.state).toBe("idle");
});
it("negação do microfone retorna para upload sem bloquear o composer", async () => {
  getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => result.current.start());
  expect(result.current.error).toContain("permissão");
  expect(result.current.isBusy()).toBe(false);
  await act(async () =>
    result.current.select(new File(["audio"], "voz.mp3", { type: "audio/mpeg" })),
  );
  expect(result.current.draft?.name).toBe("voz.mp3");
  expect(result.current.error).toBeNull();
});
it("microfone ausente oferece anexar arquivo", async () => {
  vi.stubGlobal("MediaRecorder", undefined);
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => result.current.start());
  expect(result.current.error).toContain("anexar um arquivo");
  expect(getUserMedia).not.toHaveBeenCalled();
});
it("permissão tardia após trocar conversa ou cancelar encerra tracks e não grava", async () => {
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const { result, unmount } = renderHook(() => useInboxMedia(vi.fn()));
  act(() => {
    void result.current.start();
  });
  expect(result.current.state).toBe("permission");
  unmount();
  await act(async () => resolve(fakeStream));
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("desmontar durante gravação encerra tracks e descarta resultado", async () => {
  const changed = vi.fn();
  const { result, unmount } = renderHook(() => useInboxMedia(changed));
  await act(async () => result.current.start());
  unmount();
  expect(stopTrack).toHaveBeenCalledTimes(1);
  expect(Recorder.latest.stop).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("para automaticamente em2min sem enviar", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => result.current.start());
  await act(async () => vi.advanceTimersByTimeAsync(120_000));
  expect(Recorder.latest.stop).toHaveBeenCalledTimes(1);
  expect(stopTrack).toHaveBeenCalledTimes(1);
  // FileReader completion is browser asynchronous; cancelling still releases all resources.
  act(() => result.current.cancel());
});
it("erro de gravação libera microfone e permite nova tentativa", async () => {
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => result.current.start());
  act(() => Recorder.latest.onerror?.());
  expect(result.current.error).toContain("Não foi possível gravar");
  expect(result.current.state).toBe("idle");
  expect(stopTrack).toHaveBeenCalledTimes(1);
});
it("preparação tardia de arquivo cancelado não publica prévia", async () => {
  const { result, unmount } = renderHook(() => useInboxMedia(vi.fn()));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.select(new File(["bytes"], "foto.png", { type: "image/png" }));
  });
  unmount();
  await act(async () => pending);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("WAV de2min cabe5MiB e tem cabeçalhoPCM16kHzmono e amostras limitadas", () => {
  const samples = new Float32Array(120 * 16000);
  samples[0] = -2;
  samples[1] = 2;
  const buffer = encodeWav(samples);
  const view = new DataView(buffer);
  expect(buffer.byteLength).toBeLessThan(MAX_MEDIA_BYTES);
  expect(new TextDecoder().decode(new Uint8Array(buffer, 0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(new Uint8Array(buffer, 8, 4))).toBe("WAVE");
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(view.getInt16(46, true)).toBe(32767);
});

it.each(["audio/webm;codecs=opus", "audio/mp4"])(
  "converte gravação %s em WAV real local e fecha AudioContext",
  async (mime) => {
    Recorder.isTypeSupported.mockImplementation((candidate) => candidate === mime);
    const decode = vi.fn().mockResolvedValue({ duration: 2 });
    const close = vi.fn().mockResolvedValue(undefined);
    const connect = vi.fn();
    const start = vi.fn();
    const offlineCtor = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        decodeAudioData = decode;
        close = close;
      },
    );
    vi.stubGlobal(
      "OfflineAudioContext",
      class {
        destination = {};
        constructor(...args: unknown[]) {
          offlineCtor(...args);
        }
        createBufferSource() {
          return { buffer: null, connect, start };
        }
        async startRendering() {
          return { getChannelData: () => new Float32Array([-1, 0, 1]) };
        }
      },
    );
    const original = Object.getOwnPropertyDescriptor(Blob.prototype, "arrayBuffer");
    Object.defineProperty(Blob.prototype, "arrayBuffer", {
      configurable: true,
      value: async () => new ArrayBuffer(8),
    });
    try {
      const { result } = renderHook(() => useInboxMedia(vi.fn()));
      await act(async () => result.current.start());
      act(() => result.current.stop());
      await waitFor(() => expect(result.current.draft?.mimeType).toBe("audio/wav"));
      const attachment = result.current.snapshot()[0]!;
      expect(attachment.name).toBe("gravacao.wav");
      expect(atob(attachment.base64).slice(0, 4)).toBe("RIFF");
      expect(atob(attachment.base64).slice(8, 12)).toBe("WAVE");
      expect(offlineCtor).toHaveBeenCalledWith(1, 32000, 16000);
      expect(close).toHaveBeenCalledTimes(1);
      expect(stopTrack).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(Blob.prototype, "arrayBuffer", original);
      else Reflect.deleteProperty(Blob.prototype, "arrayBuffer");
    }
  },
);

it("sem conversor local disponível oferece upload e não renomeia WebM para outro formato", async () => {
  Recorder.isTypeSupported.mockImplementation((mime) => mime === "audio/webm");
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("OfflineAudioContext", undefined);
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () => result.current.start());
  await act(async () => result.current.stop());
  expect(result.current.error).toContain("Anexe um arquivo de áudio");
  expect(result.current.draft).toBeNull();
  expect(stopTrack).toHaveBeenCalledTimes(1);
});

it("nome excessivo rejeitado no navegador antes de preparar arquivo", async () => {
  const { result } = renderHook(() => useInboxMedia(vi.fn()));
  await act(async () =>
    result.current.select(new File(["bytes"], `${"x".repeat(180)}.png`, { type: "image/png" })),
  );
  expect(result.current.error).toContain("180 caracteres");
  expect(result.current.draft).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
