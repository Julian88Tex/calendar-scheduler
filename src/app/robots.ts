// robots.txt (SPEC GEN-13; ARCHITECTURE section 23: dynamic, never prerendered at build).
import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/url";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/d/", "/p/", "/r/", "/booking", "/cancellations", "/reschedulings", "/reconfirm"],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
