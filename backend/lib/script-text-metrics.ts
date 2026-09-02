/** Spoken-word and syllable metrics for script duration budgeting. */

export type TextContentMetrics = {
  wordCount: number;
  syllableCount: number;
};

const WORD_RE = /[a-z0-9']+/gi;

/** Count spoken words in prose (punctuation-insensitive). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return (trimmed.match(WORD_RE) ?? []).length;
}

/**
 * Approximate English syllable count (consistent heuristic, not phonetic).
 * Based on vowel-group counting with common silent-ending adjustments.
 */
export function estimateSyllableCount(text: string): number {
  const words = (text.toLowerCase().match(WORD_RE) ?? []).map((w) =>
    w.replace(/[^a-z0-9']/g, ""),
  );
  let total = 0;
  for (const word of words) {
    if (!word) continue;
    total += syllablesInWord(word);
  }
  return total;
}

function syllablesInWord(word: string): number {
  if (word.length <= 3) return 1;

  let w = word;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  w = w.replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g);
  return groups && groups.length > 0 ? groups.length : 1;
}

export function textContentMetrics(text: string): TextContentMetrics {
  return {
    wordCount: countWords(text),
    syllableCount: estimateSyllableCount(text),
  };
}

export function averageTextMetrics(
  samples: TextContentMetrics[],
): TextContentMetrics | null {
  if (samples.length === 0) return null;
  const wordCount =
    samples.reduce((sum, s) => sum + s.wordCount, 0) / samples.length;
  const syllableCount =
    samples.reduce((sum, s) => sum + s.syllableCount, 0) / samples.length;
  return {
    wordCount: Math.round(wordCount * 10) / 10,
    syllableCount: Math.round(syllableCount * 10) / 10,
  };
}

/** Active speech seconds from word count at wpm × speechSpeed. */
export function speechSecondsFromWordCount(
  wordCount: number,
  speechSpeed: number,
  wpmActive = 140,
): number {
  const speed = speechSpeed > 0 ? speechSpeed : 1;
  const wpm = wpmActive * speed;
  if (wordCount <= 0 || wpm <= 0) return 0;
  return (wordCount / wpm) * 60;
}
