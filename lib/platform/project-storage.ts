import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { DynamoProjects } from "./dynamo-projects";
import { StudioError } from "../studio/store";
import { WorkspaceCatalog } from "./workspace-catalog";
const uuid = z.string().uuid();
const instances = new Map<string, DynamoProjects>();
function explicitCloudProjectIds() {
  const ids = (process.env.STUDIO_CONTENT_PROJECT_IDS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (ids.length > 100 || ids.some(id => !uuid.safeParse(id).success)) throw new StudioError(503, "클라우드 작품 목록 설정을 확인하세요.");
  return [...new Set(ids)];
}
function contentConfig() {
  const arn = process.env.STUDIO_CONTENT_TABLE_ARN ?? "";
  const workspaceId = process.env.STUDIO_CONTENT_WORKSPACE_ID ?? "";
  const profile = process.env.STUDIO_CONTENT_PROFILE;
  const parsed = /^arn:aws:dynamodb:([a-z]{2}-[a-z]+-\d):\d{12}:table\/[A-Za-z0-9_.-]{3,255}$/.exec(arn);
  if (!parsed || !uuid.safeParse(workspaceId).success) throw new StudioError(503, "클라우드 작품 저장소 설정을 확인하세요. 로컬로 전환하지 않았습니다.");
  return { arn, workspaceId, profile, region: parsed[1] };
}
function contentClient(region: string, profile?: string) { return DynamoDBDocumentClient.from(new DynamoDBClient({ region, ...(profile ? { credentials: fromIni({ profile }) } : {}), maxAttempts: 2 })); }
const catalogs = new Map<string, WorkspaceCatalog>();
export function configuredCatalog(): WorkspaceCatalog | null {
  const enabled = process.env.STUDIO_CONTENT_CATALOG;
  if (!enabled || enabled === "false") return null;
  if (enabled !== "true") throw new StudioError(503, "작품 목록 연결 설정을 확인하세요.");
  const { arn, workspaceId, profile, region } = contentConfig();
  const members = process.env.STUDIO_TEAM_TABLE_ARN ?? "";
  if (!/^arn:aws:dynamodb:[a-z0-9-]+:\d{12}:table\/[A-Za-z0-9_.-]{3,255}$/.test(members) || members.split(":").slice(0, 5).join(":") !== arn.split(":").slice(0, 5).join(":")) throw new StudioError(503, "작품과 권한 저장소는 같은 AWS 계정과 리전이어야 합니다.");
  const key = JSON.stringify([arn, members, workspaceId, profile]);
  let catalog = catalogs.get(key);
  if (!catalog) { catalog = new WorkspaceCatalog(contentClient(region, profile), arn, members, workspaceId); catalogs.set(key, catalog); }
  return catalog;
}
export async function managedCloudProjectIds() { return (await configuredCatalog()?.directory())?.ids ?? []; }
export async function cloudProjectIds() { return [...new Set([...explicitCloudProjectIds(), ...await managedCloudProjectIds()])]; }
export async function configuredProjects(id: string): Promise<DynamoProjects | null> {
  uuid.parse(id);
  if (!(await cloudProjectIds()).includes(id)) return null;
  const { arn, workspaceId, profile, region } = contentConfig();
  const key = JSON.stringify([arn, workspaceId, profile]);
  let instance = instances.get(key);
  if (!instance) {
    instance = new DynamoProjects(contentClient(region, profile), arn, workspaceId);
    instances.set(key, instance);
  }
  return instance;
}
