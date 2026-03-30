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
        out.push(line.slice(i));
        break;
      }
      if (close === i + 2) {
        out.push("**");
        i += 2;
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

    const open = line.indexOf("*", i);
    if (open === -1) {
      if (i < line.length) {
        out.push(line.slice(i));
      }
      break;
    }
    if (open > i) {
      out.push(line.slice(i, open));
    }
    const close = line.indexOf("*", open + 1);
    if (close === -1) {
      out.push(line.slice(open));
      break;
    }
    if (close === open + 1) {
      out.push("*");
      i = open + 1;
      continue;
    }
    const inner = line.slice(open + 1, close);
    out.push(
      <strong key={`${keyPrefix}-b-${k++}`} className="font-semibold">
        {inner}
      </strong>,
    );
    i = close + 1;
  }
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
                {renderBoldInLine(hm[2], `h-${idx}`)}
              </div>
            );
          } else {
            inner = (
              <span className="block min-h-[1em] whitespace-pre-wrap">
                {renderBoldInLine(line, `p-${idx}`)}
              </span>
            );
          }
        } else {
          inner = (
            <span className="block min-h-[1em] whitespace-pre-wrap">
              {renderBoldInLine(line, `tail-${idx}`)}
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
