import { redirect } from "next/navigation";

/** Old path; primary route is `/focus`. */
export default function ExtensionRedirectPage() {
  redirect("/focus");
}
