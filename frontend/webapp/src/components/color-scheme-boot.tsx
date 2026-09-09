"use client";

import { useServerInsertedHTML } from "next/navigation";
import { useRef } from "react";
import { colorSchemeBootScript } from "@/lib/color-scheme";

/**
 * Injects the color-scheme boot script into the SSR HTML stream without
 * rendering a <script> as a React child (React 19 warns / skips those).
 */
export function ColorSchemeBoot() {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return (
      <script
        id="mm-color-scheme-boot"
        dangerouslySetInnerHTML={{ __html: colorSchemeBootScript }}
      />
    );
  });
  return null;
}
