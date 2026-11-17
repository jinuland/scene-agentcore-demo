export const discoverGenres = ["일상·힐링", "로맨스", "BL", "판타지", "SF", "미스터리", "호러", "액션"] as const;
export type DiscoverGenre = typeof discoverGenres[number];
export const starterTemplates = ["blank", "character", "ensemble", "branching", "planetarium", "radio", "mirror", "midnight", "romance", "horror", "action"] as const;
export type StarterTemplate = typeof starterTemplates[number];
export const demoCatalog = {
  branching: { title: "법원의 빈 8분", genre: "미스터리" },
  planetarium: { title: "별이 꺼지기 전에", genre: "일상·힐링" },
  radio: { title: "너와 나만 듣는 트랙", genre: "BL" },
  mirror: { title: "자정에 열린 수문", genre: "판타지" },
  midnight: { title: "지도에서 지워진 13구역", genre: "SF" },
  romance: { title: "결항, 그리고 유나", genre: "로맨스" },
  horror: { title: "내 신발이 먼저 돌아왔다", genre: "호러" },
  action: { title: "마지막 차의 세 번째 좌석", genre: "액션" },
} as const satisfies Partial<Record<StarterTemplate, { title: string; genre: DiscoverGenre }>>;
export function isDemo(template: StarterTemplate): template is keyof typeof demoCatalog {
  return Object.hasOwn(demoCatalog, template);
}
export const starterLabels: Record<StarterTemplate, string> = {
  blank: "빈 작업실", character: "1:1 캐릭터 챗", ensemble: "다인 자유 스토리",
  ...Object.fromEntries(Object.entries(demoCatalog).map(([id, demo]) => [id, `${demo.genre} · ${demo.title}`])) as Record<keyof typeof demoCatalog, string>,
};
export const demoTitles = Object.fromEntries(Object.entries(demoCatalog).map(([id, demo]) => [id, demo.title])) as Partial<Record<StarterTemplate, string>>;
export function discoverGenre(value: string): DiscoverGenre | undefined {
  return discoverGenres.find(genre => genre === value);
}
