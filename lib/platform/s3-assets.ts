import { createHash } from "node:crypto";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { z } from "zod";
import { StudioError } from "../studio/store";
import { managedCloudProjectIds } from "./project-storage";

const uuid = z.string().uuid();
export const MAX_ASSET_BYTES = 12_000_000;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const unavailable = () => new StudioError(503, "S3 이미지 저장소 요청을 확인하지 못했습니다. 로컬로 전환하지 않았습니다.");
export class S3Assets {
  constructor(readonly client: S3Client, readonly bucket: string, readonly owner: string) {
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) || !/^\d{12}$/.test(owner)) throw new StudioError(503, "S3 버킷/소유 계정 설정을 확인하세요.");
  }
  private address(projectId: string, assetId: string) {
    uuid.parse(projectId); uuid.parse(assetId);
    return { Bucket: this.bucket, ExpectedBucketOwner: this.owner, Key: `projects/${projectId}/assets/${assetId}.png` };
  }
  async put(projectId: string, assetId: string, png: Uint8Array) {
    const address = this.address(projectId, assetId), bytes = Buffer.from(png);
    if (bytes.length <= 8 || bytes.length > MAX_ASSET_BYTES || !bytes.subarray(0, 8).equals(signature)) throw new StudioError(413, "보관할 PNG는 12MB 이하여야 합니다.");
    try {
      await this.client.send(new PutObjectCommand({ ...address, Body: bytes, IfNoneMatch: "*", ContentType: "image/png", ContentLength: bytes.length,
        ServerSideEncryption: "AES256", ChecksumSHA256: digest(bytes).toString("base64"),
        Metadata: { schema: "studio-asset-1", project: projectId, asset: assetId, sha256: digest(bytes).toString("hex") },
      }), { abortSignal: AbortSignal.timeout(30000) });
    } catch (e) {
      if (["PreconditionFailed", "ConditionalRequestConflict"].includes((e as Error).name)) throw new StudioError(409, "이미지 ID가 이미 존재하거나 저장 요청이 충돌했습니다. 기존 파일은 덮어쓰지 않았습니다.");
      const allowed = ["TypeError", "AccessDenied", "InvalidRequest", "BadDigest", "CredentialsProviderError", "TimeoutError", "AbortError", "NoSuchBucket", "PermanentRedirect", "SignatureDoesNotMatch", "InvalidArgument"];
      const code = allowed.includes((e as Error)?.name) ? (e as Error).name : "UpstreamError";
      // Only fixed categories, never provider text, signed URLs or request data.
      throw new StudioError(503, `${unavailable().message} [S3_PUT:${code}]`);
    }
  }
  async get(projectId: string, assetId: string): Promise<Buffer> {
    const address = this.address(projectId, assetId);
    let result;
    try { result = await this.client.send(new GetObjectCommand({ ...address, ChecksumMode: "ENABLED" }), { abortSignal: AbortSignal.timeout(30000) }); }
    catch (e) { if ((e as Error).name === "NoSuchKey") throw new StudioError(404, "S3 이미지 파일을 찾지 못했습니다."); throw unavailable(); }
    const body = result.Body;
    try {
      if (!body || !Number.isInteger(result.ContentLength) || result.ContentLength! <= 8 || result.ContentLength! > MAX_ASSET_BYTES || result.ContentType !== "image/png" || result.Metadata?.schema !== "studio-asset-1" || result.Metadata.project !== projectId || result.Metadata.asset !== assetId) throw unavailable();
      const chunks: Buffer[] = []; let total = 0;
      // Node stream consumption stays bounded even if the server lies about length.
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        total += chunk.length; if (total > MAX_ASSET_BYTES || total > result.ContentLength!) throw unavailable();
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if (total !== result.ContentLength || !bytes.subarray(0, 8).equals(signature) || digest(bytes).toString("hex") !== result.Metadata.sha256 || (result.ChecksumSHA256 && digest(bytes).toString("base64") !== result.ChecksumSHA256)) throw unavailable();
      return bytes;
    } catch { (body as { destroy?: () => void } | undefined)?.destroy?.(); throw unavailable(); }
  }
}
const instances = new Map<string, S3Assets>();
export async function configuredAssets(projectId: string): Promise<S3Assets | null> {
  uuid.parse(projectId);
  const ids = (process.env.STUDIO_S3_PROJECT_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (ids.some(id => !uuid.safeParse(id).success)) throw new StudioError(503, "S3 대상 작품 ID 설정을 확인하세요.");
  if (!ids.includes(projectId) && !(await managedCloudProjectIds()).includes(projectId)) return null;
  const bucket = process.env.STUDIO_S3_BUCKET ?? "", owner = process.env.STUDIO_S3_OWNER ?? "", region = process.env.STUDIO_S3_REGION ?? "", profile = process.env.STUDIO_S3_PROFILE;
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new StudioError(503, "S3 리전 설정을 확인하세요.");
  const key = JSON.stringify([bucket, owner, region, profile]);
  let instance = instances.get(key);
  if (!instance) {
    instance = new S3Assets(new S3Client({ region, ...(profile ? { credentials: fromIni({ profile }) } : {}), maxAttempts: 2 }), bucket, owner);
    instances.set(key, instance);
  }
  return instance;
}
