// OWNER: foundation-ui.
//
// FileUpload (ARCHITECTURE 20.2, SPEC BR-01, BR-05): image picker (button or drag and drop) with type and size checks,
// a crop dialog (square: pan by dragging or arrow keys and zoom with the slider or wheel; free: move and resize a
// rectangle) and client-side canvas resize before upload (the server never resizes). crop={false} only downsizes.
// Animated GIFs that need no resize are passed through untouched. Without an image the preview shows the initials of
// `name` (profile pictures) or an upload icon.
"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { initialsOf } from "./avatar";
import { Button } from "./button";
import { Dialog } from "./dialog";
import {
  checkImageFile,
  clampOffset,
  clampRect,
  coverScale,
  DEFAULT_IMAGE_ACCEPT,
  outputDimensions,
  outputType,
  renamedFile,
  squareSourceRect,
  type Point,
  type Rect,
} from "./file-upload-utils";
import { toast } from "./toast";

export type FileUploadProps = {
  /** Called with the (cropped, resized) file. */
  onFile: (file: File) => void | Promise<void>;
  /** Default "image/png,image/jpeg,image/webp,image/gif". */
  accept?: string;
  /** Client-side size check (default 5 MB). */
  maxBytes?: number;
  crop?: "square" | "free" | false;
  /** Longest side after resize in px (avatars: 256). */
  outputSize?: number;
  /** Current image URL (preview). */
  value?: string | null;
  onRemove?: () => void;
  /** Default "Upload image". */
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Preview shape (default: circle for square crops, rounded rectangle otherwise). */
  previewShape?: "circle" | "square";
  /** Help text under the button ("JPG, PNG or GIF. Max 5 MB."). */
  hint?: string;
  /** Profile pictures: the person's name, whose initials fill the preview while there is no image. */
  name?: string | null;
};

const STAGE = 280;
const FRAME = 240;

function loadImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };
    img.src = url;
  });
}

function canvasToFile(canvas: HTMLCanvasElement, name: string, sourceType: string): Promise<File> {
  const type = outputType(sourceType);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(new File([blob], renamedFile(name, type), { type })) : reject(new Error("The image could not be processed."))),
      type,
      0.9,
    );
  });
}

function drawToFile(img: HTMLImageElement, src: Rect, maxSide: number, name: string, sourceType: string): Promise<File> {
  const out = outputDimensions(src.width, src.height, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("The image could not be processed."));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (outputType(sourceType) === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(img, src.x, src.y, src.width, src.height, 0, 0, out.width, out.height);
  return canvasToFile(canvas, name, sourceType);
}

type CropState = { file: File; img: HTMLImageElement; url: string };

export function FileUpload({
  onFile,
  accept = DEFAULT_IMAGE_ACCEPT,
  maxBytes = 5 * 1024 * 1024,
  crop = "square",
  outputSize,
  value,
  onRemove,
  label = "Upload image",
  loading,
  disabled,
  id,
  className,
  previewShape,
  hint,
  name,
}: FileUploadProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const inputId = id ?? `${base}-file`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [cropping, setCropping] = useState<CropState | null>(null);
  const maxSide = outputSize ?? (crop === "square" ? 512 : 1600);
  const shape = previewShape ?? (crop === "square" ? "circle" : "square");

  useEffect(() => () => {
    if (cropping) URL.revokeObjectURL(cropping.url);
  }, [cropping]);

  const deliver = async (file: File) => {
    setBusy(true);
    try {
      await onFile(file);
    } catch (e) {
      const message = (e as { message?: string } | null)?.message;
      setError(message && message.length < 200 ? message : "The upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file, { accept, maxBytes });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const loaded = await loadImage(file);
      if (crop) {
        setCropping({ file, ...loaded });
        return;
      }
      const needsResize = Math.max(loaded.img.naturalWidth, loaded.img.naturalHeight) > maxSide;
      if (!needsResize) {
        URL.revokeObjectURL(loaded.url);
        await deliver(file);
        return;
      }
      const resized = await drawToFile(loaded.img, { x: 0, y: 0, width: loaded.img.naturalWidth, height: loaded.img.naturalHeight }, maxSide, file.name, file.type);
      URL.revokeObjectURL(loaded.url);
      await deliver(resized);
    } catch (e) {
      setError((e as Error).message || "This image could not be read.");
    }
  };

  const working = loading || busy;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-4 rounded-[var(--radius-card)] border border-dashed border-transparent p-1 transition-colors",
          dragOver && "border-primary bg-primary-soft",
        )}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) void handle(e.dataTransfer.files?.[0]);
        }}
      >
        <span
          className={cn(
            "inline-flex size-16 shrink-0 items-center justify-center overflow-hidden border border-line bg-mist text-ink-2",
            shape === "circle" ? "rounded-full" : "rounded-[var(--radius-card)]",
          )}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Current image" className="size-full object-cover" />
          ) : name?.trim() ? (
            <span aria-hidden="true" className="text-[24px] leading-none font-semibold select-none">
              {initialsOf(name)}
            </span>
          ) : (
            <ImageUp aria-hidden="true" className="size-6" />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={working} disabled={disabled} onClick={() => inputRef.current?.click()}>
              {label}
            </Button>
            {value && onRemove && (
              <Button variant="tertiary" size="sm" disabled={disabled || working} leftIcon={<Trash2 aria-hidden="true" />} onClick={onRemove}>
                Remove
              </Button>
            )}
          </div>
          {hint && <p className="text-body-sm text-ink-2">{hint}</p>}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          disabled={disabled || working}
          className="sr-only"
          tabIndex={-1}
          aria-label={label}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void handle(file);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-danger-text">
          {error}
        </p>
      )}
      {cropping && crop && (
        <CropDialog
          state={cropping}
          mode={crop}
          onCancel={() => setCropping(null)}
          onConfirm={async (src) => {
            try {
              const out = await drawToFile(cropping.img, src, maxSide, cropping.file.name, cropping.file.type);
              setCropping(null);
              await deliver(out);
            } catch (e) {
              toast.error((e as Error).message || "The image could not be processed.");
            }
          }}
        />
      )}
    </div>
  );
}

function CropDialog({ state, mode, onCancel, onConfirm }: { state: CropState; mode: "square" | "free"; onCancel: () => void; onConfirm: (src: Rect) => Promise<void> }) {
  const { img, url } = state;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<{ start: Point; origin: Point; kind: "pan" | "move" | "resize"; rect?: Rect } | null>(null);

  // Free mode: the image fits the stage; the selection is in display pixels.
  const fit = Math.min(STAGE / w, STAGE / h);
  const display = { width: w * fit, height: h * fit };
  const [rect, setRect] = useState<Rect>(() => clampRect({ x: display.width * 0.1, y: display.height * 0.1, width: display.width * 0.8, height: display.height * 0.8 }, display));

  const scale = coverScale(w, h, FRAME) * zoom;
  const clamped = clampOffset(offset, w, h, scale, FRAME);

  const onPointerDown = (e: React.PointerEvent, kind: "pan" | "move" | "resize") => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: kind === "pan" ? clamped : { x: rect.x, y: rect.y }, kind, rect };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (d.kind === "pan") setOffset(clampOffset({ x: d.origin.x + dx, y: d.origin.y + dy }, w, h, scale, FRAME));
    else if (d.kind === "move" && d.rect) setRect(clampRect({ ...d.rect, x: d.origin.x + dx, y: d.origin.y + dy }, display));
    else if (d.kind === "resize" && d.rect) setRect(clampRect({ ...d.rect, width: d.rect.width + dx, height: d.rect.height + dy }, display));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const confirm = async () => {
    setSaving(true);
    try {
      if (mode === "square") await onConfirm(squareSourceRect(w, h, FRAME, zoom, clamped));
      else await onConfirm({ x: rect.x / fit, y: rect.y / fit, width: rect.width / fit, height: rect.height / fit });
    } finally {
      setSaving(false);
    }
  };

  const keyNudge = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const map: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    if (mode === "square") setOffset(clampOffset({ x: clamped.x + delta.x, y: clamped.y + delta.y }, w, h, scale, FRAME));
    else if (e.altKey) setRect(clampRect({ ...rect, width: rect.width + delta.x, height: rect.height + delta.y }, display));
    else setRect(clampRect({ ...rect, x: rect.x + delta.x, y: rect.y + delta.y }, display));
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onCancel()}
      title="Crop image"
      description={
        mode === "square"
          ? "Drag the image or use the arrow keys to position it, and zoom with the slider."
          : "Drag the selection to move it and its corner to resize it (arrow keys move, Alt + arrow keys resize)."
      }
      size="sm"
      preventOutsideClose
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={saving}>
            Apply
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div
          role="application"
          aria-roledescription="Image cropper"
          aria-label="Crop area"
          tabIndex={0}
          onKeyDown={keyNudge}
          onWheel={(e) => {
            if (mode !== "square") return;
            setZoom((z) => Math.max(1, Math.min(4, z - e.deltaY * 0.002)));
          }}
          className="relative touch-none overflow-hidden rounded-[var(--radius-card)] bg-ink select-none"
          style={{ width: STAGE, height: STAGE }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {mode === "square" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                draggable={false}
                onPointerDown={(e) => onPointerDown(e, "pan")}
                className="absolute top-1/2 left-1/2 max-w-none cursor-grab active:cursor-grabbing"
                style={{
                  width: w * scale,
                  height: h * scale,
                  transform: `translate(calc(-50% + ${clamped.x}px), calc(-50% + ${clamped.y}px))`,
                }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_9999px_rgba(10,37,64,0.55)]"
                style={{ width: FRAME, height: FRAME }}
              />
            </>
          ) : (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: display.width, height: display.height }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" draggable={false} className="size-full" />
              <div
                className="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(10,37,64,0.55)]"
                style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                onPointerDown={(e) => onPointerDown(e, "move")}
              >
                <span
                  aria-hidden="true"
                  onPointerDown={(e) => onPointerDown(e, "resize")}
                  className="absolute -right-2 -bottom-2 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-primary"
                />
              </div>
            </div>
          )}
        </div>
        {mode === "square" && (
          <label className="flex w-full items-center gap-3 text-label text-ink">
            Zoom
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-[var(--primary)]"
            />
          </label>
        )}
      </div>
    </Dialog>
  );
}
