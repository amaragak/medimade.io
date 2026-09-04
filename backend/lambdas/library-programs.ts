import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { jsonAuth } from "../lib/medimade-auth-http";
import { listPublishedLibraryPrograms } from "../lib/programs";

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return jsonAuth(statusCode, payload);
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return json(204, {});
  if (method !== "GET") return json(405, { error: "Method not allowed" });

  try {
    const programs = await listPublishedLibraryPrograms();
    return json(200, { programs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "List programs failed";
    console.error("library-programs", msg);
    return json(500, { error: msg });
  }
}
