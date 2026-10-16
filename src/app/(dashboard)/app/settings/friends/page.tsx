// /app/settings/friends: the old "Friends mode" settings page, now part of Settings > Personas.
import { permanentRedirect } from "next/navigation";

export default function FriendsModePage() {
  permanentRedirect("/app/settings/personas");
}
