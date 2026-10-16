// OWNER: settings-onboarding.
//
// POST /app/settings/profile/avatar (SPEC BR-02): multipart upload of the cropped 256px profile picture (field `file`,
// JPG, PNG, GIF or WebP up to 5 MB). Same-origin only, signed-in user, rate limited; see src/lib/settings/uploads.ts.
import { route } from "@/lib/http";
import { handleImageUpload } from "@/lib/settings/uploads";

export const POST = route(async (request) => handleImageUpload(request, "avatar"));
