import type { IdeateSubtask, IdeateTodo } from "@/lib/plan-ideate-store";

export type StalledTodoCandidate = {
  todo: IdeateTodo;
  reason: "oldest_unchecked" | "viewed_often" | "was_unchecked";
};

export function findStalledTodo(
  todos: IdeateTodo[],
  subtask: IdeateSubtask,
): StalledTodoCandidate | null {
  const unchecked = todos.filter((t) => !t.isChecked);
  if (unchecked.length === 0) return null;

  const wasUnchecked = unchecked.find((t) => t.wasUnchecked);
  if (wasUnchecked) {
    return { todo: wasUnchecked, reason: "was_unchecked" };
  }

  const viewed = unchecked.find((t) => t.viewCount >= 3);
  if (viewed) {
    return { todo: viewed, reason: "viewed_often" };
  }

  const checkedCount = todos.filter((t) => t.isChecked).length;
  if (checkedCount > 0 && unchecked.length > 0) {
    const oldest = [...unchecked].sort((a, b) => a.order - b.order)[0];
    // Require the item to have been seen more than once — avoids nudging the
    // next row the moment the user checks the one above it.
    if (oldest && oldest.viewCount >= 2) {
      return { todo: oldest, reason: "oldest_unchecked" };
    }
  }

  void subtask;
  return null;
}

export const NUDGE_COPY_VARIANTS = [
  "This one's been sitting a while — anything in the way?",
  "Still here when you're ready — anything making this harder?",
  "No rush — is something quietly in the way of this step?",
];

export function pickNudgeCopy(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) % NUDGE_COPY_VARIANTS.length;
  return NUDGE_COPY_VARIANTS[h] ?? NUDGE_COPY_VARIANTS[0];
}
