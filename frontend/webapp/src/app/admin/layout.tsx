import type { ReactNode } from "react";
import { AdminPageClient } from "@/components/admin-page-client";

export const metadata = {
  title: "Admin",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <AdminPageClient>{children}</AdminPageClient>
    </div>
  );
}
