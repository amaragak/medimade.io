import { CreateWorkspace } from "@/components/create-workspace";

export const metadata = {
  title: "Create",
};

export default function CreatePage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <CreateWorkspace />
    </div>
  );
}
