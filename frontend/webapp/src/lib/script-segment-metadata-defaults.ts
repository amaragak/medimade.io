/** Client mirror of canonical segment metadata for Script Lab bulk-apply actions. */
import {
  CONNECTIVE_SEGMENT_TAGS,
  inferDefaultSegmentRepeatability,
  type ScriptSegmentRepeatability,
} from "@/lib/script-segment-tags";

export const SUGGESTED_BODY_SCAN_DESCRIPTIONS: Record<string, string> = {
  BODY_SCAN_FACE_JAW:
    "Face, jaw, forehead, and temples — releasing held tension in the upper face. Singular region beat; use once per script.",
  BODY_SCAN_NECK_SHOULDERS:
    "Neck and shoulders — softening the weight carried there. Singular; at most once per script (never triple-repeat this region).",
  BODY_SCAN_CROWN:
    "Crown and top of the head — spacious awareness at the scalp and skull. Singular region beat.",
  BODY_SCAN_SPINE_BACK:
    "General spine and upper/mid back — length through the back body. Singular. When the user has named a more specific back region (especially lower back / lumbar), prefer BODY_SCAN_LOWER_BODY or personalized custom narration instead — do not pair this tag with a lower-back-focused beat.",
  BODY_SCAN_HIPS_BELLY_CHEST:
    "Hips, belly, ribs, and chest — torso interior and breath space. Singular region beat.",
  BODY_SCAN_LOWER_BODY:
    "Lower back, hips, legs, and feet — the lower half of the body. Singular. Use this (not BODY_SCAN_SPINE_BACK) when lower-back or leg focus is personalized in the request.",
  BODY_SCAN_FULL_INTEGRATION:
    "Whole-body integration — sensing the body as one field. Singular closing scan; do not stack adjacent to other BODY_SCAN_* region tags.",
};

export function suggestedRepeatabilityForTag(tagName: string): ScriptSegmentRepeatability {
  const tag = tagName.trim().toUpperCase();
  if (CONNECTIVE_SEGMENT_TAGS.has(tag)) return "connective";
  return inferDefaultSegmentRepeatability(tag);
}

export function suggestedDescriptionForTag(tagName: string): string | undefined {
  return SUGGESTED_BODY_SCAN_DESCRIPTIONS[tagName.trim().toUpperCase()];
}
