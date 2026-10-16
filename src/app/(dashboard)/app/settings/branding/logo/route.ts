// OWNER: settings-onboarding.
//
// POST /app/settings/branding/logo (SPEC BR-05): multipart upload of the logo resized to at most 880px (field `file`,
// JPG, PNG, GIF or WebP up to 5 MB). Same-origin only, signed-in user, rate limited; see src/lib/settings/uploads.ts.
import { route } from "@/lib/http";
import { handleImageUpload } from "@/lib/settings/uploads";

export const POST = route(async (request) => handleImageUpload(request, "logo"));
