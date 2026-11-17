import { z } from "zod";
import { createHash } from "node:crypto";
// Cognito sub is an issuer-owned identifier, not an application-generated UUID.
// Observed AWS-issued values do not always meet Zod's RFC UUID variant check.
// Keep its bounded GUID shape; authenticity still comes from JWT verification.
export const cognitoSubjectSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export function serviceCreatorSubject(pool: string, sub: string) {
  const h = createHash("sha256").update(JSON.stringify(["botfactory/studio-service-account/1", pool, cognitoSubjectSchema.parse(sub)])).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
