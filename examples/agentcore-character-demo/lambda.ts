import { join } from "node:path";
import { dailyTurnQuota, dynamoStore } from "./dynamo-store";
import { createSceneService } from "./service";
import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

declare const awslambda: {
  streamifyResponse: (callback: (event: FunctionUrlEvent, stream: Writable) => Promise<void>) => unknown;
  HttpResponseStream: { from(stream: Writable, metadata: { statusCode: number; headers: Record<string, string>; cookies?: string[] }): Writable };
};

type FunctionUrlEvent = {
  rawPath: string;
  rawQueryString?: string;
  headers: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { domainName: string; http: { method: string } };
};
const { CHARACTER_DEMO_TABLE, CHARACTER_DEMO_ACCESS_CODE, CHARACTER_DEMO_RUNTIME_ARN, AWS_REGION } = process.env;
if (!CHARACTER_DEMO_TABLE || !CHARACTER_DEMO_ACCESS_CODE || !CHARACTER_DEMO_RUNTIME_ARN || !AWS_REGION) {
  throw new Error("Missing SCENE deployment settings");
}
const handle = createSceneService({
  store: dynamoStore(CHARACTER_DEMO_TABLE),
  web: join(__dirname, "web"),
  aws: { arn: CHARACTER_DEMO_RUNTIME_ARN, region: AWS_REGION },
  accessCode: CHARACTER_DEMO_ACCESS_CODE,
  publicAccess: process.env.CHARACTER_DEMO_PUBLIC_ACCESS === "true",
  chargeTurn: dailyTurnQuota(CHARACTER_DEMO_TABLE),
});

async function responseFor(event: FunctionUrlEvent) {
  const { http } = event.requestContext;
  const viewerHost = event.headers["x-scene-viewer-host"] ?? "";
  if (!/^[a-z0-9]+\.cloudfront\.net$/u.test(viewerHost)) return new Response(null, { status: 403 });
  const origin = `https://${viewerHost}`;
  const url = new URL(event.rawPath, origin);
  if (url.origin !== origin) return new Response(null, { status: 400 });
  if (event.rawQueryString) url.search = event.rawQueryString;
  const headers = new Headers();
  for (const [name, value] of Object.entries(event.headers)) if (value !== undefined) headers.set(name, value);
  if (event.cookies?.length) headers.set("Cookie", event.cookies.join("; "));
  const body = event.body === undefined ? undefined : Uint8Array.from(Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8"));
  if (body && body.byteLength > 8192) return new Response(null, { status: 413 });
  return handle(new Request(url, { method: http.method, headers, body }));
}

export const handler = awslambda.streamifyResponse(async (event, rawStream) => {
  const response = await responseFor(event);
  const cookies = response.headers.getSetCookie();
  response.headers.delete("Set-Cookie");
  const output = awslambda.HttpResponseStream.from(rawStream, {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers),
    ...(cookies.length ? { cookies } : {}),
  });
  if (response.body) await pipeline(Readable.fromWeb(response.body as never), output);
  else output.end();
});
