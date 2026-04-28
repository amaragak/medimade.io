import fs from "fs";

const outputsPath = process.argv[2];
const webappEnv = process.argv[3];
const mobileEnv = process.argv[4];
const extensionEnv = process.argv[5];

if (!outputsPath || !webappEnv) {
  console.error(
    "Usage: node write-webapp-env-from-outputs.mjs <cdk-outputs.json> <webapp/.env> [mobile/.env] [extension/.env]",
  );
  process.exit(1);
}

const o = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
const stack = o.MedimadeBackend ?? o[Object.keys(o)[0]];
const apiUrl = stack?.ApiUrl;
const chatUrl = stack?.MedimadeChatUrl;
const mediaDomain = stack?.MediaCloudFrontDomain;

if (!apiUrl || typeof apiUrl !== "string") {
  console.error("Could not read ApiUrl from CDK outputs file.");
  console.error("Keys:", Object.keys(o));
  process.exit(1);
}
if (!chatUrl || typeof chatUrl !== "string") {
  console.error("Could not read MedimadeChatUrl from CDK outputs file.");
  console.error("Stack keys:", stack ? Object.keys(stack) : []);
  process.exit(1);
}

/** @type {string | null} */
let mediaBaseUrl = null;
if (mediaDomain && typeof mediaDomain === "string") {
  const d = mediaDomain.trim();
  if (d) {
    mediaBaseUrl = /^https?:\/\//i.test(d) ? d.replace(/\/$/, "") : `https://${d}`;
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
    mediaBaseUrl ? ", NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL" : ""
  } to ${webappEnv}`,
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
