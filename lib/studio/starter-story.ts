import { emptyStory, storySchema } from "./schema";
import { isDemo, type DiscoverGenre, type StarterTemplate } from "./starter-catalog";
import { benchmarkStarter } from "./benchmark-starters";

export function starterStory(title: string, template: StarterTemplate = "blank", genre?: DiscoverGenre) {
  if (isDemo(template)) return benchmarkStarter(title, template, genre);
  const base = { ...emptyStory(), title, ...(genre ? { genre } : {}) };
  if (template === "character" || template === "ensemble") return storySchema.parse({ ...base, playMode: template === "character" ? "free" : "ensemble" });
  return base;
}
