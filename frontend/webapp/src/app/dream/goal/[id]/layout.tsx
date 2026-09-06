import { IdeateCloudProvider } from "@/components/plan/ideate-cloud-provider";

export const metadata = {
  title: "Dream workspace",
  description: "Reflect, explore resistance, and shape a vision for your dream.",
};

export default function IdeateGoalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <IdeateCloudProvider>{children}</IdeateCloudProvider>;
}
