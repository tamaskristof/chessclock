export interface Rect { x: number; y: number; w: number; h: number; }
export interface Point { x: number; y: number; }

export const MIN_ROI_SIZE = 0.05;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Screen rect occupied by a video of size vw×vh shown with object-fit: contain in a cw×ch box. */
export function containRect(cw: number, ch: number, vw: number, vh: number): Rect {
  const s = Math.min(cw / vw, ch / vh);
  const w = vw * s;
  const h = vh * s;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Screen point -> normalised video coordinates (0..1, clamped). */
export function toNormalizedPoint(px: number, py: number, content: Rect): Point {
  return { x: clamp01((px - content.x) / content.w), y: clamp01((py - content.y) / content.h) };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Normalised ROI -> screen rect. */
export function normToScreen(roi: Rect, content: Rect): Rect {
  return { x: content.x + roi.x * content.w, y: content.y + roi.y * content.h, w: roi.w * content.w, h: roi.h * content.h };
}

export function isValidRoi(r: Rect): boolean {
  return r.w >= MIN_ROI_SIZE && r.h >= MIN_ROI_SIZE && r.x >= 0 && r.y >= 0 && r.x + r.w <= 1 && r.y + r.h <= 1;
}
