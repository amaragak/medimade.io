import React from "react";
import { StyleSheet, Text, View } from "react-native";

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const headingSizes = [20, 17, 16, 15, 14, 14] as const;

function renderBoldInLine(
  line: string,
  baseStyle: object,
  boldStyle: object,
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const close = line.indexOf("**", i + 2);
      if (close === -1) {
        out.push(
          <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
            {line.slice(i)}
          </Text>,
        );
        break;
      }
      if (close === i + 2) {
        out.push(
          <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
            **
          </Text>,
        );
        i += 2;
        continue;
      }
      const inner = line.slice(i + 2, close);
      out.push(
        <Text key={`${keyPrefix}-b-${k++}`} style={[baseStyle, boldStyle]}>
          {inner}
        </Text>,
      );
      i = close + 2;
      continue;
    }

    const open = line.indexOf("*", i);
    if (open === -1) {
      if (i < line.length) {
        out.push(
          <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
            {line.slice(i)}
          </Text>,
        );
      }
      break;
    }
    if (open > i) {
      out.push(
        <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
          {line.slice(i, open)}
        </Text>,
      );
    }
    const close = line.indexOf("*", open + 1);
    if (close === -1) {
      out.push(
        <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
          {line.slice(open)}
        </Text>,
      );
      break;
    }
    if (close === open + 1) {
      out.push(
        <Text key={`${keyPrefix}-t-${k++}`} style={baseStyle}>
          *
        </Text>,
      );
      i = open + 1;
      continue;
    }
    const inner = line.slice(open + 1, close);
    out.push(
      <Text key={`${keyPrefix}-b-${k++}`} style={[baseStyle, boldStyle]}>
        {inner}
      </Text>,
    );
    i = close + 1;
  }
  return out;
}

const PAUSE_RE = /\[\[PAUSE\s+([^\]]+)\]\]/g;

function renderBoldAndPausesInLine(
  line: string,
  baseStyle: object,
  boldStyle: object,
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;

  while ((m = PAUSE_RE.exec(line)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    const before = line.slice(lastIndex, start);
    if (before) out.push(...renderBoldInLine(before, baseStyle, boldStyle, `${keyPrefix}-pre-${k}`));

    out.push(
      <Text key={`${keyPrefix}-pause-${k}`} style={[baseStyle, { fontStyle: "italic" }]}>
        {`Pause ${m[1]}`}
      </Text>,
    );

    lastIndex = end;
    k++;
  }

  const after = line.slice(lastIndex);
  if (after)
    out.push(...renderBoldInLine(after, baseStyle, boldStyle, `${keyPrefix}-post-${k}`));

  return out;
}

export default function ChatMarkdown({
  text,
  textStyle,
}: {
  text: string;
  textStyle: object;
}) {
  const lines = text.split("\n");
  const lastIndex = lines.length - 1;
  const flat = StyleSheet.flatten(textStyle) as Record<string, unknown>;
  const boldStyle = { fontWeight: "700" as const };

  return (
    <View>
      {lines.map((line, idx) => {
        const isLastLine = idx === lastIndex;
        const lineComplete = !isLastLine || text.endsWith("\n");

        if (lineComplete) {
          const hm = line.match(HEADING_RE);
          if (hm) {
            const level = Math.min(hm[1].length, 6);
            const fontSize = headingSizes[level - 1];
            const headingStyle = [
              textStyle,
              {
                fontSize,
                fontWeight: "700" as const,
                marginTop: idx === 0 ? 0 : 6,
                marginBottom: 2,
              },
            ];
            const innerBase = { ...flat, fontSize };
            return (
              <Text key={idx} style={headingStyle}>
                {renderBoldAndPausesInLine(
                  hm[2],
                  innerBase,
                  { ...innerBase, fontWeight: "700" as const },
                  `h-${idx}`,
                )}
              </Text>
            );
          }
        }

        return (
          <Text key={idx} style={[textStyle, { minHeight: line === "" ? 4 : undefined }]}>
            {renderBoldAndPausesInLine(
              line,
              textStyle,
              boldStyle,
              `p-${idx}`,
            )}
          </Text>
        );
      })}
    </View>
  );
}
