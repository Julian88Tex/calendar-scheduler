// Image upload endpoint logic for Settings (SPEC BR-02 avatar, BR-05 logo). Server only.
//
// The browser crops and resizes (FileUpload / LogoUploader) and POSTs multipart/form-data with one `file` field to a
// route handler (Server Actions cap request bodies at 1 MB; a logo may be up to 5 MB). Cookie authenticated, so the
// same-origin check guards against CSRF (GEN-08); rate limited per user. Responses: 200 { url, fileId } or the JSON
// error body of src/lib/http.ts with a `file` field error ("Images must be smaller than 5 MB.").
import "server-only";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { assertSameOrigin, json } from "@/lib/http";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { saveUserImage } from "./index";
import { IMAGE_MAX_BYTES, IMAGE_TOO_LARGE_MESSAGE, type ImageKind } from "./schemas";

/** Multipart overhead allowed on top of the 5 MB image (boundaries and part headers). */
const MULTIPART_SLACK_BYTES = 64 * 1024;
export const UPLOAD_RATE_LIMIT = { limit: 30, windowSeconds: 60 * 60 } as const;

const fileError = (message: string, status?: number) =>
  new AppError("validation", message, { fieldErrors: { file: [message] }, ...(status ? { status } : {}) });

/** Handles POST /app/settings/profile/avatar and /app/settings/branding/logo. */
export async function handleImageUpload(request: Request, kind: ImageKind): Promise<Response> {
  assertSameOrigin(request);
  const user = await requireUser({ onMissing: "throw" });
  await assertRateLimit(rateLimitKey("settings-upload", user.id), UPLOAD_RATE_LIMIT.limit, UPLOAD_RATE_LIMIT.windowSeconds, {
    message: "Too many uploads. Try again in an hour.",
  });
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES + MULTIPART_SLACK_BYTES) throw fileError(IMAGE_TOO_LARGE_MESSAGE, 413);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
    throw fileError("Choose an image to upload.");
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw fileError("Choose an image to upload.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw fileError("Choose an image to upload.");
  if (file.size > IMAGE_MAX_BYTES) throw fileError(IMAGE_TOO_LARGE_MESSAGE, 413);
  const saved = await saveUserImage(await getDb(), user.id, kind, file);
  revalidatePath("/app", "layout");
  return json({ url: saved.url, fileId: saved.fileId, width: saved.width, height: saved.height });
}
