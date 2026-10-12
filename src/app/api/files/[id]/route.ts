// GET /api/files/{id} (foundation, ARCHITECTURE section 5.4.3).
// Public purposes (avatar, logo, team_avatar, org_logo): served to anyone with `Cache-Control: public, max-age=31536000,
// immutable` and a content-hash ETag (If-None-Match answers 304); Vercel Blob files redirect to the blob URL.
// Private purposes (import, export, attachment): only the owner, never cached; anyone else gets 404 (no existence
// leak). `?download=name.csv` adds a Content-Disposition attachment header. Expired files answer 404.
import { getCurrentUser } from "@/lib/auth/session";
import { PUBLIC_FILE_PURPOSES, getFile, readFileBytes } from "@/lib/files";
import { apiError, route } from "@/lib/http";
import { isUuid } from "@/lib/ids";
import { now } from "@/lib/time/now";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function safeFilename(name: string | null): string | null {
  if (!name) return null;
  const clean = name.replace(/[^A-Za-z0-9._ -]/g, "").replace(/^\.+/, "").trim().slice(0, 120);
  return clean || null;
}

export const GET = route<Ctx>(async (request, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) return apiError("not_found");
  const file = await getFile(id);
  if (!file || (file.expiresAt && file.expiresAt.getTime() <= now().getTime())) return apiError("not_found");

  const isPublic = PUBLIC_FILE_PURPOSES.includes(file.purpose);
  if (!isPublic) {
    const user = await getCurrentUser();
    if (!user || !file.ownerUserId || user.id !== file.ownerUserId) return apiError("not_found");
  }

  const etag = `"${file.sha256}"`;
  const cacheControl = isPublic ? "public, max-age=31536000, immutable" : "private, no-store";
  const base: Record<string, string> = {
    "Cache-Control": cacheControl,
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  };

  if (isPublic && file.blobUrl && !file.data) {
    return new Response(null, { status: 302, headers: { ...base, Location: file.blobUrl } });
  }
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });

  const bytes = await readFileBytes(file);
  const headers: Record<string, string> = {
    ...base,
    "Content-Type": file.contentType,
    "Content-Length": String(bytes.length),
  };
  const download = safeFilename(new URL(request.url).searchParams.get("download"));
  if (download || !isPublic) headers["Content-Disposition"] = `attachment${download ? `; filename="${download}"` : ""}`;
  return new Response(new Uint8Array(bytes), { status: 200, headers });
});
