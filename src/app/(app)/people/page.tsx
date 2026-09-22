import { redirect } from "next/navigation";

/**
 * People & roles moved into the admin panel. Kept as a redirect because the
 * old path is in the avatar menu of anyone with a tab open, and in at least
 * one README.
 */
export default function PeoplePage() {
  redirect("/admin?tab=people");
}
