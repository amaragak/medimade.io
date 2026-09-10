"use client";

import { useEffect, useRef } from "react";
import { Tldraw, type Editor } from "tldraw";
import "tldraw/tldraw.css";

type Props = {
  dreamId: string;
};

function appColorScheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function PlanLifeAreaWhiteboardInner({ dreamId }: Props) {
  const editorRef = useRef<Editor | null>(null);

  useEffect(() => {
    const apply = () => {
      const scheme = appColorScheme();
      editorRef.current?.user.updateUserPreferences({ colorScheme: scheme });
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => mo.disconnect();
  }, []);

  return (
    <Tldraw
      persistenceKey={`mm-life-area-whiteboard-${dreamId}`}
      className="h-full w-full"
      colorScheme={appColorScheme()}
      onMount={(editor) => {
        editorRef.current = editor;
        editor.user.updateUserPreferences({
          colorScheme: appColorScheme(),
        });
      }}
    />
  );
}
