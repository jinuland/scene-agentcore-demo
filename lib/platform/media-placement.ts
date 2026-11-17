import { z } from "zod";
import type { Story, Asset } from "../studio/schema";
import type { ProductionBoard, WorkItem } from "./production";
import type { Release } from "./runtime-store";

export const mediaPlacementSchema = z.object({
  category: z.enum(["character", "location", "object"]),
  target: z.string().trim().min(1).max(80),
  situation: z.string().trim().min(1).max(80),
  sceneId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
}).strict();
export type MediaPlacement = z.infer<typeof mediaPlacementSchema>;
export const mediaCategoryLabel = { character: "인물", location: "장소", object: "사물" } as const;
export function mediaTarget(story: Story, p: MediaPlacement) {
  const scene = story.scenes.find(s => s.id === p.sceneId);
  if (!scene) return undefined;
  if (p.category === "character") return scene.characterIds.includes(p.target) ? story.characters.find(c => c.id === p.target)?.name : undefined;
  if (p.category === "location") return scene.locationId === p.target ? story.locations.find(l => l.id === p.target)?.name : undefined;
  return p.target;
}
export function placementAssetAllowed(item: WorkItem, asset: Asset, board: ProductionBoard) {
  return item.assetIds.includes(asset.id) || asset.briefId === item.id ||
    board.items.some(source => source.status === "approved" && source.selectedAssetId === asset.id);
}
export function placementCards(release: Release) {
  const pinned = new Set(release.assets?.map(a => a.id));
  return (release.production?.items ?? []).flatMap(item => {
    const { mediaPlacement: p, expressionWhen: when } = item.version.content;
    const assetId = item.version.selectedAssetId;
    if (!p || !when || item.kind !== "cut" || item.version.status !== "approved" || !assetId || !pinned.has(assetId)) return [];
    const target = mediaTarget(release.story, p);
    if (!target) return [];
    return [{ key: `m_${item.id.replaceAll("-", "").slice(0,24)}`, placement: p, assetId, when, label: `${target} · ${p.situation}` }];
  });
}
