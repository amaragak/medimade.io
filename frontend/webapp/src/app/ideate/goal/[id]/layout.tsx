import { IdeateCloudProvider } from "@/components/plan/ideate-cloud-provider";

export const metadata = {
  title: "Ideate workspace",
  description: "Reflect, explore resistance, and shape a vision for your goal.",
};

export default function IdeateGoalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <IdeateCloudProvider>{children}</IdeateCloudProvider>;
}
