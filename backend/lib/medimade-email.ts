import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const secrets = new SecretsManagerClient({});
let cachedBrevoKey: string | undefined;

async function getBrevoApiKey(): Promise<string> {
  if (cachedBrevoKey) return cachedBrevoKey;
  const secretName = process.env.BREVO_SECRET_NAME?.trim();
  if (!secretName) throw new Error("BREVO_SECRET_NAME is not set");
  const out = await secrets.send(
    new GetSecretValueCommand({ SecretId: secretName }),
  );
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Brevo API key secret is empty");
  cachedBrevoKey = s;
  return cachedBrevoKey;
}

export async function sendEmailBrevo(params: {
  fromEmail: string;
  fromName?: string;
  toEmail: string;
  subject: string;
  text: string;
}): Promise<void> {
  const apiKey = await getBrevoApiKey();
  const fromEmail = params.fromEmail.trim();
  const toEmail = params.toEmail.trim();
  if (!fromEmail) throw new Error("fromEmail is required");
  if (!toEmail) throw new Error("toEmail is required");

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: fromEmail,
        ...(params.fromName?.trim() ? { name: params.fromName.trim() } : {}),
      },
      to: [{ email: toEmail }],
      subject: params.subject,
      textContent: params.text,
    }),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 2000);
    throw new Error(`Brevo send failed (${res.status}): ${detail || res.statusText}`);
  }
}

