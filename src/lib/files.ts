// Uploaded files (ARCHITECTURE sections 5.4.3 and 21; SPEC GEN-09: no blob store required).
//
// Bytes live in files.data (bytea) by default, or in Vercel Blob when BLOB_READ_WRITE_TOKEN is set (REST API, no SDK).
// GET /api/files/{id} serves them: public with an immutable cache for avatar, logo, team_avatar and org_logo;
// owner-only for import, export and attachment.
//
// Images: PNG, JPEG, WebP and GIF only (never SVG: it can carry script when served from our origin). There is no
// server-side resizing (native modules such as sharp are not allowed): the client resizes with a canvas before upload
// and the server checks type (by magic bytes), size and dimensions.
import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { isTransaction } from "@/db/helpers";
import { files } from "@/db/schema";
import { AppError } from "./errors";
import { enqueueJob } from "./jobs/queue";
import { log } from "./logger";

export type FilePurpose = (typeof files.$inferSelect)["purpose"];
export type FileRow = typeof files.$inferSelect;
export type ImagePurpose = Extract<FilePurpose, "avatar" | "logo" | "team_avatar" | "org_logo">;

/** Purposes served publicly (with an immutable cache). */
export const PUBLIC_FILE_PURPOSES: readonly FilePurpose[] = ["avatar", "logo", "team_avatar", "org_logo"];
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_DIMENSION = 4096;

/** Path that serves a file (relative; use fileAbsoluteUrl() from src/lib/url.ts in emails). */
export function fileUrl(id: string): string {
  return `/api/files/${id}`;
}

/** Detects an image type from its first bytes (PNG, JPEG, GIF, WebP), or null. */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Pixel dimensions from the image header (no decoding), or null when unreadable. */
export function imageDimensions(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    switch (type) {
      case "image/png":
        // IHDR: width and height big-endian at 16 and 20.
        return bytes.length >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : null;
      case "image/gif":
        return bytes.length >= 10 ? { width: view.getUint16(6, true), height: view.getUint16(8, true) } : null;
      case "image/webp": {
        const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
        if (chunk === "VP8X" && bytes.length >= 30) {
          const w = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16));
          const h = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16));
          return { width: w, height: h };
        }
        if (chunk === "VP8 " && bytes.length >= 30) {
          return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        }
        if (chunk === "VP8L" && bytes.length >= 25) {
          const b0 = bytes[21]!, b1 = bytes[22]!, b2 = bytes[23]!, b3 = bytes[24]!;
          return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
        }
        return null;
      }
      case "image/jpeg": {
        let i = 2;
        while (i + 9 < bytes.length) {
          if (bytes[i] !== 0xff) {
            i++;
            continue;
          }
          const marker = bytes[i + 1]!;
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2;
            continue;
          }
          const len = view.getUint16(i + 2);
          // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
          }
          i += 2 + len;
        }
        return null;
      }
    }
  } catch {
    return null;
  }
}

async function toBuffer(file: Blob | Uint8Array | Buffer | ArrayBuffer): Promise<Buffer> {
  if (Buffer.isBuffer(file)) return file;
  if (file instanceof Uint8Array) return Buffer.from(file.buffer, file.byteOffset, file.byteLength);
  if (file instanceof ArrayBuffer) return Buffer.from(file);
  return Buffer.from(await file.arrayBuffer());
}

function blobStoreId(token: string): string {
  return token.split("_")[3] ?? "";
}

/** Uploads to Vercel Blob (public store) and returns the blob URL. */
async function putBlob(pathname: string, body: Buffer, contentType: string): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN!;
  const res = await fetch(`https://vercel.com/api/blob/?${new URLSearchParams({ pathname })}`, {
    method: "PUT",
    body: new Uint8Array(body),
    headers: {
      authorization: `Bearer ${token}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": blobStoreId(token),
      "x-vercel-blob-access": "public",
      "x-content-type": contentType,
      "x-add-random-suffix": "1",
      "x-cache-control-max-age": "31536000",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`blob upload failed: HTTP ${res.status}`);
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("blob upload returned no url");
  return json.url;
}

/** Deletes a Vercel Blob by URL (no-op without BLOB_READ_WRITE_TOKEN). Throws when the store refuses or is unreachable. */
export async function deleteBlobNow(url: string): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  const res = await fetch("https://vercel.com/api/blob/delete", {
    method: "POST",
    body: JSON.stringify({ urls: [url] }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-api-version": "12",
      "x-vercel-blob-store-id": blobStoreId(token),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`blob delete failed: HTTP ${res.status}`);
}

/** Job that deletes a blob once the transaction that deleted its files row has committed. */
export const DELETE_BLOB_JOB = "files.delete_blob";

export type SaveFileInput = {
  data: Blob | Uint8Array | Buffer | ArrayBuffer;
  contentType: string;
  purpose: FilePurpose;
  ownerUserId: string | null;
  organizationId?: string | null;
  width?: number | null;
  height?: number | null;
  /** Exports and imports expire (system.cleanup removes them). */
  expiresAt?: Date | null;
  db?: DbOrTx;
};

/** Stores bytes (bytea, or Vercel Blob when configured) and returns the files row. */
export async function saveFile(input: SaveFileInput): Promise<FileRow> {
  const db = input.db ?? (await getDb());
  const bytes = await toBuffer(input.data);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let blobUrl: string | null = null;
  if (process.env.BLOB_READ_WRITE_TOKEN && PUBLIC_FILE_PURPOSES.includes(input.purpose)) {
    // Only public purposes go to the public blob store; private files stay in the database.
    const ext = input.contentType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "bin";
    blobUrl = await putBlob(`${input.purpose}/${sha256.slice(0, 16)}.${ext}`, bytes, input.contentType);
  }
  const [row] = await db
    .insert(files)
    .values({
      ownerUserId: input.ownerUserId,
      organizationId: input.organizationId ?? null,
      purpose: input.purpose,
      contentType: input.contentType,
      byteSize: bytes.length,
      sha256,
      data: blobUrl ? null : bytes,
      blobUrl,
      width: input.width ?? null,
      height: input.height ?? null,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  if (!row) throw new Error("file insert returned no row");
  return row;
}

export type SaveImageOptions = {
  ownerUserId: string | null;
  organizationId?: string | null;
  maxBytes?: number;
  maxDimension?: number;
  minDimension?: number;
  db?: DbOrTx;
};

/**
 * Validates and stores an uploaded image (avatar, logo, team avatar, org logo). Throws AppError("validation") with a
 * `file` field error for wrong types, oversize files or dimensions out of range.
 */
export async function saveImageUpload(
  file: Blob | Uint8Array | Buffer | ArrayBuffer,
  purpose: ImagePurpose,
  opts: SaveImageOptions,
): Promise<{ id: string; url: string; width: number; height: number; contentType: ImageType; byteSize: number }> {
  const invalid = (message: string) => new AppError("validation", message, { fieldErrors: { file: [message] } });
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  const bytes = await toBuffer(file);
  if (bytes.length === 0) throw invalid("Choose an image to upload.");
  if (bytes.length > maxBytes) throw invalid(`Images must be smaller than ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  const type = detectImageType(bytes);
  if (!type) throw invalid("Upload a PNG, JPG, WebP or GIF image.");
  const dims = imageDimensions(bytes, type);
  const max = opts.maxDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
  const min = opts.minDimension ?? 1;
  if (!dims || dims.width < min || dims.height < min) throw invalid("This image could not be read.");
  if (dims.width > max || dims.height > max) throw invalid(`Images can be at most ${max} by ${max} pixels.`);
  const row = await saveFile({
    data: bytes,
    contentType: type,
    purpose,
    ownerUserId: opts.ownerUserId,
    organizationId: opts.organizationId,
    width: dims.width,
    height: dims.height,
    db: opts.db,
  });
  return { id: row.id, url: fileUrl(row.id), width: dims.width, height: dims.height, contentType: type, byteSize: row.byteSize };
}

/** The file row (with bytes when stored in the database), or null. */
export async function getFile(id: string, db?: DbOrTx): Promise<FileRow | null> {
  const d = db ?? (await getDb());
  const [row] = await d.select().from(files).where(eq(files.id, id)).limit(1);
  return row ?? null;
}

/** The bytes of a file (from the database or Vercel Blob). */
export async function readFileBytes(row: FileRow): Promise<Buffer> {
  if (row.data) return row.data;
  if (row.blobUrl) {
    const res = await fetch(row.blobUrl, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`blob read failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.alloc(0);
}

/**
 * Deletes a file row and its blob. The blob is never deleted inside the caller's transaction: there the deletion is
 * enqueued as a files.delete_blob job in the same transaction, so it happens only after the commit (a rollback keeps
 * both the row and the blob). Outside a transaction the row is gone already and the blob is deleted at once.
 */
export async function deleteFile(id: string, db?: DbOrTx): Promise<void> {
  const d = db ?? (await getDb());
  const [row] = await d.delete(files).where(eq(files.id, id)).returning({ blobUrl: files.blobUrl });
  if (!row?.blobUrl) return;
  if (isTransaction(d)) {
    await enqueueJob(d, { type: DELETE_BLOB_JOB, payload: { url: row.blobUrl } });
    return;
  }
  await deleteBlobNow(row.blobUrl).catch(async (e: unknown) => {
    log.warn("files.blob_delete_failed", { error: e });
    await enqueueJob(d, { type: DELETE_BLOB_JOB, payload: { url: row.blobUrl } });
  });
}
