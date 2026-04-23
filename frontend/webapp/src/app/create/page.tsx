import { redirect } from "next/navigation";

export const metadata = {
  title: "Create",
};

export default function CreatePage() {
  redirect("/meditate/create");
}
