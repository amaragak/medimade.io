import fs from "fs";

const outputsPath = process.argv[2];
const webappEnv = process.argv[3];
if (!outputsPath || !webappEnv) {
  console.error("Usage: node write-webapp-env-from-outputs.mjs <cdk-outputs.json> <webapp/.env>");
  process.exit(1);
}

const o = JSON.parse(fs.readFileSync(outputsPath, "utf8"));
const stack = o.MedimadeBackend ?? o[Object.keys(o)[0]];
const apiUrl = stack?.ApiUrl;
const chatUrl = stack?.MedimadeChatUrl;

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

const pairs = [
  ["NEXT_PUBLIC_MEDIMADE_API_URL", apiUrl],
  ["NEXT_PUBLIC_MEDIMADE_CHAT_URL", chatUrl],
];

let lines;
try {
  lines = fs.readFileSync(webappEnv, "utf8").split(/\r?\n/);
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

fs.writeFileSync(webappEnv, lines.join("\n").replace(/\n+$/, "") + "\n");
console.log(`Wrote NEXT_PUBLIC_MEDIMADE_API_URL and NEXT_PUBLIC_MEDIMADE_CHAT_URL to ${webappEnv}`);
