// Icons of the location rows (SPEC VID-01: video for conferencing, pin for in-person and invitee-provided places, phone
// for calls, info for custom locations). Server and client safe.
import { Info, MapPin, Phone, Video } from "lucide-react";
import type { LocationIcon } from "./lib/locations";

export function LocationGlyph({ icon, className }: { icon: LocationIcon; className?: string }) {
  const props = { "aria-hidden": true as const, className, strokeWidth: 2 };
  switch (icon) {
    case "video":
      return <Video {...props} />;
    case "phone":
      return <Phone {...props} />;
    case "custom":
      return <Info {...props} />;
    default:
      return <MapPin {...props} />;
  }
}
