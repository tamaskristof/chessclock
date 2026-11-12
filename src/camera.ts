import type { Rect } from "./geometry";
import { FEATURE_SIZE, toFeature, type Feature } from "./vision";

export async function startCamera(video: HTMLVideoElement): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 320 },
      height: { ideal: 240 },
      frameRate: { ideal: 15, max: 15 },
    },
  });
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
}

export function stopCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

/** Crops the normalised ROI out of the current video frame into a 32×32 feature. */
export class FrameSampler {
  private readonly ctx: CanvasRenderingContext2D;

  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = FEATURE_SIZE;
    canvas.height = FEATURE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  sample(video: HTMLVideoElement, roi: Rect): Feature | null {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    this.ctx.drawImage(video, roi.x * vw, roi.y * vh, roi.w * vw, roi.h * vh, 0, 0, FEATURE_SIZE, FEATURE_SIZE);
    return toFeature(this.ctx.getImageData(0, 0, FEATURE_SIZE, FEATURE_SIZE).data);
  }
}
