// Browser side of the Settings image uploads (SPEC BR-02, BR-05): POSTs the cropped and resized file as multipart to
// the settings route handlers and turns error bodies into readable messages. Client only (fetch, FormData).
import type { ImageKind } from "@/lib/settings/schemas";

export const UPLOAD_PATHS: Record<ImageKind, string> = {
  avatar: "/app/settings/profile/avatar",
  logo: "/app/settings/branding/logo",
};

export const UPLOAD_FAILED_MESSAGE = "The upload failed. Try again.";

type ErrorBody = { message?: unknown; fieldErrors?: Record<string, unknown> };

function messageOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as ErrorBody;
  const field = b.fieldErrors?.file;
  if (Array.isArray(field) && typeof field[0] === "string") return field[0];
  return typeof b.message === "string" && b.message ? b.message : null;
}

/** Uploads the image and resolves with its URL; rejects with an Error whose message is user-facing copy. */
export async function uploadSettingsImage(kind: ImageKind, file: File): Promise<{ url: string; fileId: string }> {
  const body = new FormData();
  body.append("file", file, file.name || `${kind}.png`);
  let res: Response;
  try {
    res = await fetch(UPLOAD_PATHS[kind], { method: "POST", body, credentials: "same-origin" });
  } catch {
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    if (res.status === 413) throw new Error(messageOf(json) ?? "Images must be smaller than 5 MB.");
    throw new Error(messageOf(json) ?? UPLOAD_FAILED_MESSAGE);
  }
  const data = json as { url?: unknown; fileId?: unknown } | null;
  if (!data || typeof data.url !== "string" || typeof data.fileId !== "string") throw new Error(UPLOAD_FAILED_MESSAGE);
  return { url: data.url, fileId: data.fileId };
}
