#!/usr/bin/env node
/**
 * Write frontend/webapp/.env (and optional mobile/extension) from either:
 *   - a CDK `--outputs-file` JSON, or
 *   - the live CloudFormation stack (always fresh — preferred in CI)
 *
 * Usage:
 *   node write-webapp-env-from-outputs.mjs <cdk-outputs.json> <webapp/.env> [mobile/.env] [extension/.env]
 *   node write-webapp-env-from-outputs.mjs --stack MedimadeBackend <webapp/.env> [mobile/.env] [extension/.env]
 */
import { execFileSync } from "child_process";
import fs from "fs";

const args = process.argv.slice(2);

/**
 * @param {string} stackName
 * @returns {Record<string, Record<string, string>>}
 */
function outputsFromCloudFormation(stackName) {
  const raw = execFileSync(
    "aws",
    [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--output",
      "json",
    ],
    { encoding: "utf8" },
  );
  const stacks = JSON.parse(raw).Stacks ?? [];
  const stack = stacks[0];
  if (!stack) {
    throw new Error(`CloudFormation stack not found: ${stackName}`);
  }
  /** @type {Record<string, string>} */
  const map = {};
  for (const o of stack.Outputs ?? []) {
    if (o.OutputKey && o.OutputValue != null) {
      map[o.OutputKey] = String(o.OutputValue);
    }
  }
  return { [stackName]: map };
}

/** @type {Record<string, Record<string, string>>} */
let o;
/** @type {string} */
let webappEnv;
/** @type {string | undefined} */
let mobileEnv;
/** @type {string | undefined} */
let extensionEnv;

if (args[0] === "--stack") {
  const stackName = args[1]?.trim();
  webappEnv = args[2];
  mobileEnv = args[3];
  extensionEnv = args[4];
  if (!stackName || !webappEnv) {
    console.error(
      "Usage: node write-webapp-env-from-outputs.mjs --stack <StackName> <webapp/.env> [mobile/.env] [extension/.env]",
    );
    process.exit(1);
  }
  o = outputsFromCloudFormation(stackName);
} else {
  const outputsPath = args[0];
  webappEnv = args[1];
  mobileEnv = args[2];
  extensionEnv = args[3];
  if (!outputsPath || !webappEnv) {
    console.error(
      "Usage: node write-webapp-env-from-outputs.mjs <cdk-outputs.json> <webapp/.env> [mobile/.env] [extension/.env]",
    );
    console.error(
      "   or: node write-webapp-env-from-outputs.mjs --stack MedimadeBackend <webapp/.env> [mobile/.env] [extension/.env]",
    );
    process.exit(1);
  }
  o = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
}

const stack = o.MedimadeBackend ?? o[Object.keys(o)[0]];
const apiUrl = stack?.ApiUrl;
const chatUrl = stack?.MedimadeChatUrl;
const scriptLabUrl = stack?.AdminScriptLabUrl;
const mediaDomain = stack?.MediaCloudFrontDomain;

if (!apiUrl || typeof apiUrl !== "string") {
  console.error("Could not read ApiUrl from stack outputs.");
  console.error("Keys:", Object.keys(o));
  process.exit(1);
}
if (!chatUrl || typeof chatUrl !== "string") {
  console.error("Could not read MedimadeChatUrl from stack outputs.");
  console.error("Stack keys:", stack ? Object.keys(stack) : []);
  process.exit(1);
}

/** @type {string | null} */
let mediaBaseUrl = null;
if (mediaDomain && typeof mediaDomain === "string") {
  const d = mediaDomain.trim();
  if (d) {
    mediaBaseUrl = /^https?:\/\//i.test(d)
      ? d.replace(/\/$/, "")
      : `https://${d}`;
  }
}

/**
 * @param {string} filePath
 * @param {readonly [string, string][]} pairs
 */
function mergeEnvFile(filePath, pairs) {
  let lines;
  try {
    lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  } catch {
    lines = [];
  }

  for (const [key, value] of pairs) {
    let found = false;
    lines = lines.map((line) => {
      if (line.startsWith(`${key}=`)) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(filePath, lines.join("\n").replace(/\n+$/, "") + "\n");
}

const nextPairs = [
  ["NEXT_PUBLIC_MEDIMADE_API_URL", apiUrl],
  ["NEXT_PUBLIC_MEDIMADE_CHAT_URL", chatUrl],
  ...(scriptLabUrl && typeof scriptLabUrl === "string"
    ? [["NEXT_PUBLIC_MEDIMADE_SCRIPT_LAB_URL", scriptLabUrl]]
    : []),
  ...(mediaBaseUrl
    ? [["NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL", mediaBaseUrl]]
    : []),
];

const expoPairs = [
  ["EXPO_PUBLIC_MEDIMADE_API_URL", apiUrl],
  ["EXPO_PUBLIC_MEDIMADE_CHAT_URL", chatUrl],
  ...(mediaBaseUrl
    ? [["EXPO_PUBLIC_MEDIMADE_MEDIA_BASE_URL", mediaBaseUrl]]
    : []),
];

mergeEnvFile(webappEnv, nextPairs);
console.log(
  `Wrote NEXT_PUBLIC_MEDIMADE_API_URL, NEXT_PUBLIC_MEDIMADE_CHAT_URL${
    scriptLabUrl ? ", NEXT_PUBLIC_MEDIMADE_SCRIPT_LAB_URL" : ""
  }${mediaBaseUrl ? ", NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL" : ""} to ${webappEnv}`,
);

if (mobileEnv) {
  mergeEnvFile(mobileEnv, expoPairs);
  console.log(
    `Wrote EXPO_PUBLIC_MEDIMADE_API_URL, EXPO_PUBLIC_MEDIMADE_CHAT_URL${
      mediaBaseUrl ? ", EXPO_PUBLIC_MEDIMADE_MEDIA_BASE_URL" : ""
    } to ${mobileEnv}`,
  );
}

if (extensionEnv) {
  const extPairs = [["VITE_MEDIMADE_API_URL", apiUrl]];
  mergeEnvFile(extensionEnv, extPairs);
  console.log(`Wrote VITE_MEDIMADE_API_URL to ${extensionEnv}`);
}
