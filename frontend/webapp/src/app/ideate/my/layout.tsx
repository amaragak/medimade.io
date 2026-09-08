import { IdeateCloudProvider } from "@/components/plan/ideate-cloud-provider";

export default function IdeateMyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <IdeateCloudProvider>{children}</IdeateCloudProvider>;
}
