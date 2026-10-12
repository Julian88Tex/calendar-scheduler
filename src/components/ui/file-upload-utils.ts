// OWNER: foundation-ui.
//
// Pure helpers of FileUpload (server and client safe): file checks and the crop geometry (pan and zoom under a fixed
// square frame, or a free rectangle), plus output sizing for the client-side canvas resize (the server never
// resizes, ARCHITECTURE 21).

export const DEFAULT_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** "Upload a JPG, PNG, GIF or WebP image." / "The image must be 5 MB or smaller." or null when acceptable. */
export function checkImageFile(file: { type: string; size: number }, opts: { accept?: string; maxBytes?: number } = {}): string | null {
  const accept = (opts.accept ?? DEFAULT_IMAGE_ACCEPT).split(",").map((s) => s.trim().toLowerCase());
  const type = file.type.toLowerCase();
  const ok = accept.some((a) => a === type || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));
  if (!ok) return "Upload a JPG, PNG, GIF or WebP image.";
  const max = opts.maxBytes ?? 5 * 1024 * 1024;
  if (file.size > max) return `The image must be ${formatBytes(max)} or smaller.`;
  if (file.size === 0) return "This file is empty.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`.replace(".0 ", " ");
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/** Scale at zoom 1 so the image covers a square frame. */
export function coverScale(imgW: number, imgH: number, frame: number): number {
  return Math.max(frame / imgW, frame / imgH);
}

/** Keeps the panned image covering the frame. */
export function clampOffset(offset: Point, imgW: number, imgH: number, scale: number, frame: number): Point {
  const maxX = Math.max(0, (imgW * scale - frame) / 2);
  const maxY = Math.max(0, (imgH * scale - frame) / 2);
  return { x: Math.max(-maxX, Math.min(maxX, offset.x)), y: Math.max(-maxY, Math.min(maxY, offset.y)) };
}

/**
 * The source rectangle (image pixels) under a centered square frame, for an image drawn at `coverScale * zoom` and
 * moved by `offset` (display pixels, image center relative to the frame center).
 */
export function squareSourceRect(imgW: number, imgH: number, frame: number, zoom: number, offset: Point): Rect {
  const scale = coverScale(imgW, imgH, frame) * zoom;
  const size = frame / scale;
  const x = imgW / 2 - (frame / 2 + offset.x) / scale;
  const y = imgH / 2 - (frame / 2 + offset.y) / scale;
  return {
    x: Math.max(0, Math.min(imgW - size, x)),
    y: Math.max(0, Math.min(imgH - size, y)),
    width: Math.min(size, imgW),
    height: Math.min(size, imgH),
  };
}

/** Clamps a free crop rectangle (display pixels) inside the displayed image bounds with a minimum size. */
export function clampRect(rect: Rect, bounds: { width: number; height: number }, min = 24): Rect {
  const width = Math.max(min, Math.min(bounds.width, rect.width));
  const height = Math.max(min, Math.min(bounds.height, rect.height));
  return {
    x: Math.max(0, Math.min(bounds.width - width, rect.x)),
    y: Math.max(0, Math.min(bounds.height - height, rect.y)),
    width,
    height,
  };
}

/** Output canvas size: the longest side at most `maxSide`, never upscaled. */
export function outputDimensions(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Encoding for the re-encoded image: PNG keeps transparency (PNG, GIF, WebP sources), JPEG otherwise. */
export function outputType(sourceType: string): "image/png" | "image/jpeg" {
  return /png|gif|webp/.test(sourceType) ? "image/png" : "image/jpeg";
}

export function renamedFile(name: string, type: "image/png" | "image/jpeg"): string {
  const stem = name.replace(/\.[^.]+$/, "") || "image";
  return `${stem}.${type === "image/png" ? "png" : "jpg"}`;
}
