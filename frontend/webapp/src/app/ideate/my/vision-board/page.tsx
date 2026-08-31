import { IdeateVisionBoardClient } from "@/components/plan/ideate-vision-board-client";

export const metadata = {
  title: "Vision board",
  description:
    "Gather images and colours for what you’re moving toward — a quiet Ideate vision board.",
};

export default function IdeateVisionBoardPage() {
  return <IdeateVisionBoardClient />;
}
