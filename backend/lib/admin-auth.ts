import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { jsonAuth, requireUserJson, type MedimadeAuthUser } from "./medimade-auth-http";

export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdminJson(
  event: APIGatewayProxyEventV2,
): Promise<MedimadeAuthUser | APIGatewayProxyStructuredResultV2> {
  /** Temporary: admin UI/API is open until ADMIN_REQUIRE_AUTH=1 is set. */
  if (process.env.ADMIN_REQUIRE_AUTH !== "1") {
    return { sub: "admin-open" };
  }
  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const user = auth as MedimadeAuthUser;
  const allowed = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (allowed.length === 0) {
    return jsonAuth(403, { error: "Admin access is not configured" });
  }
  if (allowed.includes("*")) return user;
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email || !allowed.includes(email)) {
    return jsonAuth(403, {
      error: "Admin access required",
      detail: email
        ? `Signed in as ${email}. Deploy with -c adminEmails=${email} to allow this account.`
        : "Signed-in email missing from session.",
    });
  }
  return user;
}
