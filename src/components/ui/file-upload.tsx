// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// FileUpload (ARCHITECTURE 20.2): image picker with a crop dialog (square or free) and client-side canvas resize before
// upload (the server never resizes). Foundation stub: a native file input that passes the chosen file through.
"use client";

import { cn } from "@/lib/cn";

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
};

export function FileUpload({ onFile, accept = "image/png,image/jpeg,image/webp,image/gif", maxBytes = 5 * 1024 * 1024, value, onRemove, label = "Upload image", loading, disabled, id, className }: FileUploadProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      {value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="size-16 rounded object-cover" />
      )}
      <label className="text-body-md text-primary-text">
        {label}
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled || loading}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file && file.size <= maxBytes) void onFile(file);
          }}
        />
      </label>
      {value && onRemove && (
        <button type="button" onClick={onRemove} className="text-body-md text-danger-text">
          Remove
        </button>
      )}
    </div>
  );
}
