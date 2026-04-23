import { redirect } from "next/navigation";

export const metadata = {
  title: "Library",
};

export default async function LibraryPage() {
  redirect("/meditate/library");
}
