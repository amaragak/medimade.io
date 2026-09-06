import { redirect } from "next/navigation";

/** Legacy URL — product is now Dream. */
export default function IdeateRedirectPage() {
  redirect("/dream");
}
