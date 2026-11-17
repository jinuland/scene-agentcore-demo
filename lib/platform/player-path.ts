import { z } from "zod";
// A single exact relative project/release URL; no generic redirect capability.
export const playerReturnPath = z.string().refine(value => {
  if (value === "/play") return true;
  const match = /^\/play\/([^/?#]+)(?:\?release=([^&#]+))?$/.exec(value);
  return !!match && z.string().uuid().safeParse(match[1]).success && (!match[2] || z.string().uuid().safeParse(match[2]).success);
}, "유효한 작품 주소가 아닙니다.");
export const serviceReturnPath = z.union([playerReturnPath, z.literal("/team")]);
