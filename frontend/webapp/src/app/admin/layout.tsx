import type { ReactNode } from "react";
import { AdminPageClient } from "@/components/admin-page-client";

export const metadata = {
  title: "Admin",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminPageClient>{children}</AdminPageClient>;
}
