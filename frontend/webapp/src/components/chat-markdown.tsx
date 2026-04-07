"use client";

import { type ReactNode } from "react";

/**
 * Streaming-friendly markdown subset:
 * - **bold** or *bold* — only when closing delimiters are found.
 * - # heading — ATX only on complete lines (last line is plain until a trailing newline).
 */
function renderBoldInLine(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const close = line.indexOf("**", i + 2);
      if (close === -1) {
        // Unclosed marker while streaming: drop the marker and keep parsing.
        i += 2;
        continue;
      }
      if (close === i + 2) {
        // Empty bold marker: drop it.
        i += 4;
        continue;
      }
      const inner = line.slice(i + 2, close);
      out.push(
        <strong key={`${keyPrefix}-b-${k++}`} className="font-semibold">
          {inner}
        </strong>,
      );
      i = close + 2;
      continue;
    }

    const ch = line[i];
    if (ch !== "*") {
      const next = line.indexOf("*", i);
      if (next === -1) {
        out.push(line.slice(i));
        break;
      }
      out.push(line.slice(i, next));
      i = next;
      continue;
    }

    // Single '*' marker
    const close = line.indexOf("*", i + 1);
    if (close === -1) {
      // Unclosed marker while streaming: drop it.
      i += 1;
      continue;
    }
    if (close === i + 1) {
      // "**" case is handled above; for "*/" empty marker, drop it.
      i += 2;
      continue;
    }
    const inner = line.slice(i + 1, close);
    out.push(
      <strong key={`${keyPrefix}-b-${k++}`} className="font-semibold">
        {inner}
      </strong>,
    );
    i = close + 1;
  }
  return out;
}

const PAUSE_RE = /\[\[PAUSE\s+([^\]]+)\]\]/g;

function renderBoldAndPausesInLine(line: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = PAUSE_RE.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    const before = line.slice(lastIndex, start);
    if (before) out.push(...renderBoldInLine(before, `${keyPrefix}-pre-${k}`));

    out.push(
      <em key={`${keyPrefix}-pause-${k}`} className="italic font-medium">
        {`Pause ${m[1]}`}
      </em>,
    );

    lastIndex = end;
    k++;
  }

  const after = line.slice(lastIndex);
  if (after) out.push(...renderBoldInLine(after, `${keyPrefix}-post-${k}`));

  return out;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

export function ChatMarkdown({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;

  return (
    <div className={className}>
      {lines.map((line, idx) => {
        const isLastLine = idx === lastIndex;
        const lineComplete = !isLastLine || text.endsWith("\n");

        let inner: ReactNode;
        if (lineComplete) {
          const hm = line.match(HEADING_RE);
          if (hm) {
            const level = Math.min(hm[1].length, 6) as 1 | 2 | 3 | 4 | 5 | 6;
            const sizes: Record<number, string> = {
              1: "text-base font-semibold tracking-tight",
              2: "text-[15px] font-semibold tracking-tight",
              3: "text-sm font-semibold",
              4: "text-sm font-semibold",
              5: "text-sm font-medium",
              6: "text-sm font-medium",
            };
            inner = (
              <div
                className={`${sizes[level]} mt-1 first:mt-0 mb-0.5`}
                role="heading"
                aria-level={level}
              >
                {renderBoldAndPausesInLine(hm[2], `h-${idx}`)}
              </div>
            );
          } else {
            inner = (
              <span className="block min-h-[1em] whitespace-pre-wrap">
                {renderBoldAndPausesInLine(line, `p-${idx}`)}
              </span>
            );
          }
        } else {
          inner = (
            <span className="block min-h-[1em] whitespace-pre-wrap">
              {renderBoldAndPausesInLine(line, `tail-${idx}`)}
            </span>
          );
        }

        return (
          <div key={idx} className="min-h-[1em]">
            {inner}
          </div>
        );
      })}
    </div>
  );
}
