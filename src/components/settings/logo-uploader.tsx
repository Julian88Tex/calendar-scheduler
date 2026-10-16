// Branding "Logo" (SPEC BR-05): a wide preview of the current logo (object-contain, like the booking page panel), "Upload
// image" (button or drag and drop) and "Remove" after a confirmation. The browser checks type and size, downsizes
// logos wider or taller than 880px (animated GIFs that fit and stay under 4 MB are uploaded untouched) and uploads at
// once.
"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { checkImageFile, outputDimensions, outputType, renamedFile } from "@/components/ui/file-upload-utils";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  IMAGE_TOO_LARGE_MESSAGE,
  LOGO_HINT,
  LOGO_MAX_SIZE,
  LOGO_PASSTHROUGH_MAX_BYTES,
} from "@/lib/settings/schemas";
import { uploadSettingsImage } from "./upload-image";

export type LogoUploaderProps = {
  value: string | null;
  onChange: (url: string | null) => void;
  /** Removes the logo on the server; resolves with an error message or null. */
  onRemove: () => Promise<string | null>;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };
    img.src = url;
  });
}

/**
 * The file to upload: the original when it fits in 880px and is small enough to pass the hosting body limit, else a
 * canvas copy downsized to 880px (PNG keeps transparency; a large animated GIF becomes its first frame).
 */
async function prepareLogo(file: File): Promise<File> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error("This image could not be read.");
  if (Math.max(w, h) <= LOGO_MAX_SIZE && file.size <= LOGO_PASSTHROUGH_MAX_BYTES) return file;
  const out = outputDimensions(w, h, LOGO_MAX_SIZE);
  const canvas = document.createElement("canvas");
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The image could not be processed.");
  const type = outputType(file.type);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(img, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
  if (!blob) throw new Error("The image could not be processed.");
  return new File([blob], renamedFile(file.name, type), { type });
}

export function LogoUploader({ value, onChange, onRemove }: LogoUploaderProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    const problem = checkImageFile(file, { accept: IMAGE_ACCEPT, maxBytes: IMAGE_MAX_BYTES });
    if (problem) {
      setError(file.size > IMAGE_MAX_BYTES ? IMAGE_TOO_LARGE_MESSAGE : problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const prepared = await prepareLogo(file);
      const saved = await uploadSettingsImage("logo", prepared);
      onChange(saved.url);
      toast.success("Logo updated");
    } catch (e) {
      const message = (e as { message?: string } | null)?.message;
      setError(message && message.length < 200 ? message : "The upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div
        className={cn(
          "flex min-h-[152px] w-full max-w-[360px] items-center justify-center rounded-[var(--radius-card)] border border-line bg-white p-4 transition-colors",
          !value && "border-dashed border-line-medium",
          dragOver && "border-primary bg-primary-soft",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) void handle(e.dataTransfer.files?.[0]);
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="Your logo" className="max-h-[120px] max-w-full object-contain" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-center text-body-md text-ink-2">
            <ImageUp aria-hidden="true" className="size-7" />
            No logo yet. Drop an image here or upload one.
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" loading={busy} onClick={() => inputRef.current?.click()} aria-describedby={`${id}-hint`}>
          {value ? "Change image" : "Upload image"}
        </Button>
        {value && (
          <Button variant="tertiary" size="sm" disabled={busy} leftIcon={<Trash2 aria-hidden="true" />} onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        )}
      </div>
      <p id={`${id}-hint`} className="text-body-sm text-ink-2">
        {LOGO_HINT}
      </p>
      <input
        ref={inputRef}
        id={`${id}-file`}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload logo"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void handle(file);
        }}
      />
      {error && (
        <p role="alert" className="text-body-sm font-semibold text-danger-text">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove logo?"
        description="Your booking pages and notifications will no longer show a logo."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={async () => {
          const problem = await onRemove();
          // ConfirmDialog keeps the dialog open and shows the message as a toast.
          if (problem) throw new Error(problem);
          toast.success("Logo removed");
        }}
      />
    </div>
  );
}
