import { redirect } from "next/navigation";

/** Legacy URL — product is Ideate. */
export default function DreamRedirectPage() {
  redirect("/ideate");
}
