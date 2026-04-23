"use client";

import { createContext, useContext } from "react";

export const JournalTranscribeApiContext = createContext<string | null>(null);

export function useJournalTranscribeApiBase(): string | null {
  return useContext(JournalTranscribeApiContext);
}
