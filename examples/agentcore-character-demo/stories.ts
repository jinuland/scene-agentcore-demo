import { z } from "zod";
import type { NarrativeDefinition } from "../../lib/platform/narrative-graph";
import { withWorldEngine } from "./world-definitions";
import { sarangStory } from "./sarang-story";
import { storyBeats } from "../../lib/platform/story-beats";
import { benchmarkStarter } from "../../lib/studio/benchmark-starters";
import { story as record } from "../last-record/story";

export const genres = ["판타지", "SF", "로맨스", "BL"] as const;
export const moods = ["neutral", "focused", "concerned", "relieved", "happy", "sad", "angry"] as const;
export type Mood = (typeof moods)[number];
type Card = { file: string; label: string; when?: string };
type PreviewTurn = { input: string; reply: string };
export type Story = {
  public?:true;
  publicTemplateAvailable?:true;
  publicTemplate?:import("./creator").CreatorDocument;
  id: string; title: string; genre: (typeof genres)[number]; tagline: string; role: string;
  scene: string; prologue: string; greeting: string; cover: string; character: string;
  job: string; voice: string; setting: string; facts: string[]; suggestions: string[];
  cards: Partial<Record<Mood, Card>> & Record<"neutral", Card>; custom?: true;
  trustWhen?: string; objective?: string; premiseBadge?: string; source?: { label: string; url: string };
  field?: { label: string; initial: string; unlocked: string };
  previewTurns?: readonly PreviewTurn[];
  prologueImages?: { file: string; label: string }[];
  narrative?: NarrativeDefinition;
  narrativePresentation?: NarrativeDefinition;
  creator?: { workId?:string; version?:number; memo?:string; savedAt?:string; revision: number; status: "draft" | "published"; sourceId?: string; document?: import("./creator").CreatorDocument; preview?: boolean };
  media?: {id:string;file:string;label:string}[];
  playSettings?: {model:string;responseLength:"short"|"scene";starts:{id:string;title:string}[]};
};
const art = (key: string) => `/art/${key}.webp`;
const radio = benchmarkStarter("너와 나만 듣는 트랙", "radio");
const seoyun = record.characters[0];
const eungyeol = radio.characters[0];
const authoredStories: Story[] = [
  sarangStory,
  {
    id: "academy", title: "퇴학까지 9일, 내 소환사는 낙제생", genre: "판타지",
    tagline: "눈을 뜨니 소환진 안. 그런데 당신을 소환한 사람이 곧 퇴학당한다.",
    role: "마법 아카데미에서 소환된 정체불명의 여우 정령", scene: "해 질 무렵 · 아카데미 소환실",
    prologue: "소환진 바깥에서 종이 두 번 울렸다. 감독관은 재심 통지서를 내려놓고 나갔다. 소환진에 남은 건 여우 정령이 된 당신과, 시험을 두 번 떨어진 소환사 한 명뿐이다. 통지서 맨 아래에 붉은 글씨로 ‘9일’이 적혀 있다.",
    greeting: "제 말 들려요? 도망가고 싶으면 막지 않을게요. 대신 잠깐만요. 저 종이가 뭔지는 설명할 기회를 주세요.",
    cover: art("academy-cover"), character: "리에", job: "재심을 앞둔 성인 소환사",
    voice: "긴장하면 정중한 말이 빨라지고, 중요한 결정에는 한 박자 쉬는 존댓말. 도움을 당연히 여기지 않는다.",
    setting: "성인 마법 아카데미의 소환술 실습. 리에는 첫 시험에서 소환에 실패하고 두 번째에서 계약 등록을 못 했다. 이번에 남은 건 재심뿐이다.",
    facts: ["퇴학 재심까지 9일이다. 이 소환실 대화만으로 하루가 지나거나 재심에 합격하지 않는다.", "정식 재심을 받으려면 소환사와 정령이 각자 동의해야 한다. 임시 등록은 정식 계약이 아니다.", "정령의 능력은 아직 평가하지 않았다.", "리에는 당신의 전생 이름과 기억을 모른다."],
    suggestions: ["리에, 내가 재심 준비를 같이 도울게요.", "왜 퇴학 대상이에요? 통지서를 보여주세요.", "계약을 하지 않으면 저는 어떻게 되죠?"],
    previewTurns: [
      { input: "통지서에 적힌 9일은 무슨 뜻이에요?", reply: "[행동] 리에가 종이를 돌려 붉은 글씨가 보이게 한다.\n[대사] 재심까지 남은 날이에요. 첫 시험에선 소환조차 못 했고, 두 번째엔 계약을 등록하지 못했어요." },
      { input: "재심을 도와줄게요. 대신 제가 뭘 할 수 있는지부터 확인하고 싶어요.", reply: "[대사] 좋아요. 이름 옆에 능력부터 적으라고 해도 빈칸으로 둘게요. 우리가 함께 확인한 것만 쓰면 되니까요." },
      { input: "연습하다 그만하고 싶으면요?", reply: "[행동] 리에가 깃펜을 책상에 내려놓는다.\n[대사] 그땐 멈춰요. 정식 계약은 우리 둘 다 원할 때만 할 수 있어요." },
    ],
    objective: "리에와 재심 조건 확인하기",
    trustWhen: "플레이어가 리에를 도와 재심을 준비하거나 함께 실습하겠다고 직접 제안한다. 퇴학 이유나 계약 조건을 묻거나 가능성을 가정하는 것은 제외한다.",
    field: { label: "재심 접수", initial: "미등록 · D-9", unlocked: "준비 중 · D-9" },
    premiseBadge: "소환수 빙의 · 아카데미",
    source: { label: "참고: 코기토의 크랙 원작", url: "https://share.crack.wrtn.ai/ptcus73" },
    cards: {
      neutral: { file: art("academy-scene"), label: "소환진 앞에서 만난 리에" },
      focused: { file: art("academy-focused"), label: "정령 쪽으로 손을 내민 리에", when: "플레이어가 지금 리에의 재심 준비에 협력하겠다고 직접 제안해 리에가 정령에게 손을 내민다." },
      concerned: { file: art("academy-concerned"), label: "재심을 걱정하는 리에", when: "플레이어가 재심 또는 퇴학의 구체적인 이유를 묻자 리에가 통지서를 확인하며 걱정을 드러낸다." },
    },
  },
  {
    id: "outer-rim", title: "스타워즈: 아우터 림의 마지막 통신", genre: "SF",
    tagline: "제국의 순찰이 다가온다. 당신 손에는 반란군 피난민의 항로가 들어 있다.",
    role: "반란군 협력 요청을 받은 민간 화물선 조종사", scene: "아우터 림 · 외곽 달의 화물 격납고",
    prologue: "격납고 신호등이 노란색에서 적색으로 바뀌었다. 나린은 덮개가 닫히지 않은 항법 단말을 옆으로 밀었다. 오늘 밤 통과하기로 한 피난민 선박 여섯 척의 항로가 그 안에 있었다.",
    greeting: "제국 순찰이 여기로 돌고 있어. 이 항로를 맡아줄래? 싫으면 지금 말해. 네 배에 누굴 태울지는 네 결정이야.",
    cover: art("outer-cover"), character: "나린", job: "반란군을 돕는 민간 항법 정비사",
    voice: "건조하고 친근한 반말. 항로 위험을 숨기지 않고 상대의 선택을 다시 확인한다.",
    setting: "스타워즈 은하 제국과 반란군 연합 시대를 배경으로 한 비공식 팬 에피소드. 인물·항로·정거장은 이 테스트의 창작 설정이다.",
    facts: ["단말에는 피난민 여섯 척의 예정 항로가 있다. 선박은 아직 출발하지 않았다.", "제국 순찰은 접근 중이며 아직 격납고에 도착하지 않았다.", "직행이나 우회를 제안할 수 있지만 안전을 보장할 수 없다."],
    suggestions: ["내 배로 피난 항로를 전달할게. 먼저 확인하자.", "왜 우회로는 열어 두지 않았어?", "위험을 줄일 다른 방법이 있어?"],
    previewTurns: [
      { input: "항로를 기다리는 배가 몇 척이야?", reply: "[행동] 나린이 단말을 켜고 화면의 점을 하나씩 짚는다.\n[대사] 여섯 척. 한 척도 아직 출발 안 했어. 어디로 가라고 할지 우리가 정해야 해." },
      { input: "내 배로 전달할게. 직행보다 늦어져도 우회가 나을까?", reply: "[대사] 우회하면 예비 연료를 더 써. 직행은 짧지만 순찰이 돌아올 시점을 몰라. 네 배가 얼마나 버틸 수 있는지부터 보자." },
      { input: "연료를 확인하기 전에는 출발 신호 보내지 말자.", reply: "[행동] 나린이 송신 버튼에서 손을 뗀다.\n[대사] 알았어. 항로만 네 단말로 보낼게. 출발 신호는 네가 확인할 때까지 보류야." },
    ],
    trustWhen: "플레이어가 피난민 또는 나린을 도와 항로를 지키거나 전달하겠다고 직접 제안한다.",
    objective: "피난 항로를 누구에게 맡길지 결정하기", premiseBadge: "비공식 팬 시나리오",
    field: { label: "항로 인계", initial: "대기", unlocked: "인계 준비" },
    source: { label: "설정 참고: StarWars.com", url: "https://www.starwars.com/databank/rebel-alliance" },
    cards: { neutral: { file: art("outer-cover"), label: "외곽 달의 화물 격납고" } },
  },
  {
    id: "girlfriend", title: "여자친구 사귀기: 마지막 곡은 네가 골라", genre: "로맨스",
    tagline: record.authoring!.tagline!, role: record.startSettings![0].role, scene: "11시 57분 · 레코드 바 파형",
    prologue: record.startSettings![0].prologue, greeting: seoyun.firstLine,
    cover: art("record-cover"), character: seoyun.name, job: seoyun.role, voice: seoyun.voice, setting: record.premise,
    facts: [...record.rules, ...record.facts.filter(f => f.visibility === "public").map(f => f.statement)],
    suggestions: record.startSettings![0].suggestions,
    previewTurns: [
      { input: "내 커피에 아직도 설탕 안 넣었어?", reply: "[행동] 서윤이 커피잔을 손잡이 쪽으로 돌려 준다.\n[대사] 까먹은 척하려고 했는데, 설탕 넣고 네 표정까지 보는 건 좀 아깝더라." },
      { input: "음반 안의 편지, 왜 아직 안 열었어?", reply: "[대사] 네가 나한테 준 적은 없잖아. 가게에 두고 간 거지. 그래서 오늘도 네가 먼저 말할 때까지 기다렸어." },
      { input: "오늘은 안 열어도 될 것 같아. 대신 마지막 곡은 네가 골라줘.", reply: "[행동] 서윤이 봉투를 밀어 넣고 턴테이블 앞에 선다.\n[대사] 좋아. 곡 끝나면 커피 한 잔 더 할지나 말해 줘." },
    ],
    trustWhen: "플레이어가 과거에 나누지 못한 대화를 지금 차분히 이어가자고 제안하거나 편지를 열지 여부를 서윤과 함께 결정하자고 한다.",
    objective: "서윤과 다시 만날 수 있는지 마음을 나누기", premiseBadge: "성인 · 재회 연애 시뮬레이션",
    field: { label: "오늘의 관계", initial: "재회 · 대화 중", unlocked: "서로의 마음을 확인 중" },
    cards: { neutral: { file: art("record-prologue"), label: "파형에서 다시 만난 서윤" } },
  },
  {
    id: "radio", title: radio.title, genre: "BL",
    tagline: radio.premise, role: radio.playerRole, scene: "방송 12분 전 · 달섬 라디오 조정실",
    prologue: radio.scenes[0].opening.split("\n\n")[0], greeting: "12분 줄게. 끝까지 듣고도 싫으면, 오늘도 안 틀어.",
    cover: art("radio-cover"), character: eungyeol.name, job: eungyeol.role, voice: eungyeol.voice, setting: radio.tone,
    facts: [...radio.rules, ...radio.boundaries, ...radio.facts.filter(f => f.visibility === "public").map(f => f.statement)],
    suggestions: ["방송에는 올리지 말고 우리 둘만 먼저 듣자.", ...radio.startSettings![0].suggestions],
    previewTurns: [
      { input: "이 트랙 언제 복구했어?", reply: "[행동] 은결이 파형 위에 마우스 커서를 올려놓고 재생은 누르지 않는다.\n[대사] 어젯밤. 맨 뒤에 아무 소리도 없는 줄 알았는데, 그게 아니더라." },
      { input: "방송에는 올리지 말고 우리 둘만 먼저 듣자.", reply: "[행동] 은결이 헤드폰 하나를 책상 너머로 밀어 준다.\n[대사] 응. 이쪽 헤드폰은 송출선이랑 안 이어져 있어. 듣다 멈추고 싶으면 네가 꺼." },
      { input: "8초쯤 조용하네. 이 다음에는 뭐가 나와?", reply: "[대사] 그때 방송 끝나면 너한테 하려고 했던 말. 녹음은 오래됐는데, 네 앞에서 들으려니까 어제 한 말 같다." },
    ],
    trustWhen: "플레이어가 트랙을 공개하기 전에 은결과 상의하거나 두 사람만 먼저 듣자고 제안한다.",
    objective: "은결이 복구한 트랙을 어떻게 남길지 정하기", premiseBadge: "성인 BL · 재회",
    field: { label: "복구 트랙", initial: "송출 보류", unlocked: "비공개 청취 준비" },
    cards: {
      neutral: { file: art("radio-neutral"), label: "마이크 앞에 선 은결" },
      focused: { file: art("radio-focused"), label: "트랙을 살펴보는 은결", when: "플레이어가 둘만의 청취를 명확히 제안하고 은결이 장비를 살핀다." },
    },
  },
];
export const stories: Story[] = authoredStories.map(withWorldEngine);
export const draftSchema = z.object({
  title: z.string().trim().min(1).max(48), name: z.string().trim().min(1).max(24), genre: z.enum(genres),
  setting: z.string().trim().min(1).max(700), role: z.string().trim().min(1).max(120), greeting: z.string().trim().min(1).max(400),
  cover: z.enum(["academy", "outer-rim", "girlfriend", "radio"]), trustWhen: z.string().trim().max(180).optional(),
}).strict();
export function draftStory(id: string, draft: z.infer<typeof draftSchema>): Story {
  const sample = stories.find(s => s.id === draft.cover)!;
  return withWorldEngine({
    id, custom: true, title: draft.title, character: draft.name, genre: draft.genre,
    tagline: draft.setting, prologue: draft.setting, setting: draft.setting, role: draft.role, greeting: draft.greeting,
    cover: sample.cover, scene: "첫 장면", job: "현재 이야기에서 플레이어와 대화하는 인물", voice: "장면과 인물 설정에 맞는 자연스러운 한국어 말투.",
    facts: [], suggestions: ["지금 무슨 일이 있었나요?", "먼저 자기소개를 해 주세요."], trustWhen: draft.trustWhen || undefined,
    cards: { neutral: { file: sample.cover, label: "작품 표지" } },
  });
}
export const publicStory = ({ public:published, publicTemplate, publicTemplateAvailable, id, title, genre, tagline, role, scene, prologue, greeting, cover, character, job, suggestions, cards, custom, trustWhen, objective, premiseBadge, source, field, previewTurns, prologueImages, narrative, media, creator, playSettings }: Story) => ({
  public:!!published, hasTemplate:!!publicTemplate||!!publicTemplateAvailable, id, title, genre, tagline, role, scene, prologue, greeting, cover, character, job, suggestions, custom, hasTrust: !!trustWhen, objective, premiseBadge, source, field, prologueImages, hasNarrative: !!narrative,
  preview:creator?.preview, hasMedia:!!media?.length, starts:playSettings?.starts ?? creator?.document?.starts.map(s=>({id:s.id,title:s.title})), recommendedModel:playSettings?.model ?? creator?.document?.profile.model, recommendedLength:playSettings?.responseLength ?? creator?.document?.profile.responseLength,
  previewTurns: previewTurns?.map(turn => ({ input: turn.input, beats: storyBeats(turn.reply) })),
  cards: Object.fromEntries(Object.entries(cards).map(([key, { file, label }]) => [key, { file, label }])),
});
