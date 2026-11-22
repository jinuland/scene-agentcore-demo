import {z} from 'zod';
import {structured} from '../../lib/studio/bedrock';
import {creatorDocumentSchema,inspectCreator,type CreatorDocument} from './creator';
import {StudioError} from '../../lib/studio/store';
export const authorBriefSchema=z.object({world:z.string().max(5000),flow:z.string().max(5000),rules:z.string().max(5000),ending:z.string().max(3000)}).strict();
export type AuthorBrief=z.infer<typeof authorBriefSchema>;
// The author edits prose; only the server compiles the proposed definition.
// Media ownership, file URLs and the profile never come from generated output.
const proposalSchema=z.object({narrative:creatorDocumentSchema.shape.narrative,starts:creatorDocumentSchema.shape.starts}).strict();
const gate=z.object({counter:z.string(),op:z.enum(['gte','lte','eq']),value:z.number()}).strict();
const generationSchema=z.object({
 summary:z.string(),
 characters:z.array(z.object({id:z.string(),name:z.string(),role:z.string(),voice:z.string(),description:z.string(),appearance:z.string()}).strict()),
 counters:z.array(z.object({id:z.string(),label:z.string(),initial:z.number(),min:z.number(),max:z.number(),unit:z.string(),visible:z.boolean()}).strict()),
 scenes:z.array(z.object({id:z.string(),speaker:z.string(),title:z.string(),location:z.string(),opening:z.string(),objective:z.string(),minTurns:z.number(),choices:z.array(z.object({id:z.string(),text:z.string(),actionId:z.string(),transitionId:z.string(),conditions:z.array(gate)}).strict())}).strict()),
 events:z.array(z.object({id:z.string(),label:z.string(),when:z.string(),result:z.string(),scenes:z.array(z.string()),once:z.boolean(),opensTransition:z.string(),effects:z.array(z.object({counter:z.string(),delta:z.number()}).strict()),conditions:z.array(gate)}).strict()),
 transitions:z.array(z.object({id:z.string(),from:z.string(),to:z.string(),label:z.string(),when:z.string(),conditions:z.array(gate)}).strict()),
 endings:z.array(z.object({id:z.string(),title:z.string(),text:z.string(),scenes:z.array(z.string()),conditions:z.array(gate),priority:z.number()}).strict()),
 starts:z.array(z.object({id:z.string(),title:z.string(),sceneId:z.string(),prologue:z.string(),greeting:z.string()}).strict())
}).strict();
export function normalizeAuthorIds<T>(value:T):T{
 const referenceKeys=new Set(['id','counter','actionId','transitionId','opensTransition','from','to','sceneId','speaker','characterId']);
 const visit=(node:unknown,key=''):unknown=>Array.isArray(node)?node.map(v=>typeof v==='string'&&key==='scenes'?v.replaceAll('_','-'):visit(v)):
 node&&typeof node==='object'?Object.fromEntries(Object.entries(node).map(([k,v])=>[k,typeof v==='string'&&referenceKeys.has(k)?v.replaceAll('_','-'):visit(v,k)])):node;
 return visit(value) as T;
}
export function materializeProposal(current:CreatorDocument,value:z.infer<typeof generationSchema>){
 value=normalizeAuthorIds(value);
 const priorities=[...new Set(value.endings.map(e=>e.priority))].sort((a,b)=>a-b);
 const generatedIds=new Set(value.events.map(e=>e.id));
 const retainedEvents=current.narrative.id==='custom-world'?[]:current.narrative.events.filter(e=>!generatedIds.has(e.id));
 const normalizePriority=value.endings.some(e=>e.priority<0||e.priority>100||!Number.isInteger(e.priority));
 return {narrative:{...structuredClone(current.narrative),id:current.narrative.id==='custom-world'?'authored-world':current.narrative.id,summary:value.summary,startScene:value.starts[0]?.sceneId,characters:value.characters,counters:value.counters,scenes:value.scenes.map(s=>({...s,mood:'neutral' as const,suggestions:[],choices:s.choices.map(c=>({...c,actionId:c.actionId||undefined,transitionId:c.transitionId||undefined}))})),events:[...value.events.map(e=>({...e,minutes:0,opensTransition:e.opensTransition||undefined})),...structuredClone(retainedEvents)],transitions:value.transitions,endings:value.endings.map(e=>({...e,priority:normalizePriority?Math.round((priorities.indexOf(e.priority)+1)*100/priorities.length):e.priority})),media:[],facts:structuredClone(current.narrative.facts),statusFields:structuredClone(current.narrative.statusFields??[]),plotThreads:structuredClone(current.narrative.plotThreads??[]),milestones:structuredClone(current.narrative.milestones??[]),translations:undefined},starts:value.starts.map(s=>({...s,values:current.starts.find(x=>x.id===s.id)?.values??{}}))};
}
export function finishProposal(current:CreatorDocument,brief:AuthorBrief,value:z.infer<typeof proposalSchema>){
 const doc:CreatorDocument={...structuredClone(current),narrative:value.narrative,starts:value.starts,authorBrief:brief};
 // Existing conditional media must never become less restricted after AI editing.
 doc.narrative.media=structuredClone(current.narrative.media??[]);
 const checked=inspectCreator(doc);
 if(!checked.ok)throw new StudioError(422,'이야기 규칙을 완성하지 못했습니다. 현재 초안은 유지됩니다. 요청을 조금 나누어 다시 구성해 주세요.');
 return checked.document;
}
export async function assistCreator(current:CreatorDocument,brief:AuthorBrief,signal?:AbortSignal){
 if(!Object.values(brief).some(s=>s.trim()))throw new StudioError(400,'세계관이나 원하는 사건을 먼저 적어 주세요.');
 const generated=await structured(generationSchema,[
 '당신은 일반인이 작성한 이야기 설명을 실행 가능한 캐릭터 챗봇 세계 규칙으로 컴파일하는 편집자다. 한국어로 작성한다.',
 'brief가 작가의 최신 요청이다. 기존 작품을 수정하는 경우 명시하지 않은 세계관·인물·시작·장면·스탯·조건은 최대한 보존한다. 빈 새 작품의 예시 문구와 HP는 의도된 설정이 아니므로 필요 없으면 제거한다. 작품에 맞는 스탯 2~4개와 필요한 비공개 진행 플래그를 스스로 설계하되 전체 counter 최대16개, event 최대32개. 등장인물 ID는 보존한다. 기존 미디어·설정집·상태창·진행사건·중간성과가 참조하는 장면·스탯·행동 ID와 의미도 보존한다.',
 '제작자는 ID, 그래프, 부등식을 쓰지 않는다. 연료가 바닥나면 표류한다, 순찰을 무시하면 발각된다 같은 문장을 수치 조건과 행동 효과, 실패 엔딩으로 구성한다. 단순 요약만 하지 말고 실제 실행되는 규칙으로 만든다.',
 '일반적으로 장면 3~5개, 각 장면에 서로 다른 실행 선택 3개 이상을 두고 선택의 대가를 반영한다. 실제 발생한 행동만 events가 갱신한다. 질문·가정·거절을 실행으로 판정하지 않도록 when을 쓴다. once 행동이 완료되고 잠긴 후보를 제외해도 선택 가능한 질문·행동이 남도록 각 scene.choices를 4~6개 구성한다. 일반 질문은 actionId 없이, 상태 변화는 actionId로 연결한다.',
 'scene.minTurns는 해당 장면에 머문 대화 턴의 최소값이며 보통 2~3이다. 장면 전이는 명시적인 이동·실행 의사에만 발생한다. 사건이 바로 다음 장면을 열면 event.opensTransition에 그 transition ID를 연결한다. 조건은 AND이며 OR는 경로를 나누어 만든다. effects.delta는 증가/감소이며 최종 수치가 아니다. 선택형 값은 0부터 정수로 관리한다.',
 '실패 조건은 해당 실패가 일어날 수 있는 모든 scenes에 연결한다. 연료 0같은 실패는 별도의 끝내기 버튼 없이 실제 수치로 판정한다. 성공은 목표를 실제 달성한 조건, 실패는 실제 위험 조건으로만 확정한다. 회차의 인사나 다음 만남 약속으로 이야기를 임의 종료하지 않는다. 모든 ending은 scenes와 최소 하나의 유효 조건을 가져야 하며 실패 우선순위가 성공보다 높아야 한다. priority는 0~100 정수이다.',
 '모든 id와 참조 ID는 영문 소문자로 시작하는 영문 소문자·숫자·하이픈만 쓰며 64자 이하이다. 밑줄이나 한글을 ID에 쓰지 않는다. 각 scene은 title/location/opening/objective가 필요하다. characters는 name/role/voice/description/appearance를 가진다. startScene과 starts.sceneId, 모든 counter/actionId/transitionId/scenes 참조를 일치시킨다. 기본 시작점 하나 이상을 만든다. narrative.summary 1600자 이내. min/max/initial 범위를 지킨다. starts에는 values를 쓰지 않는다. 초기값은 counters.initial에만 쓴다. startTime은 ISO8601+시간대이다.',
 '설정집의 중요한 사실은 summary나 해당 인물 description에 보존한다. 기존 미디어는 서버가 보존하므로 반환하지 않는다. 이 간단 설계안에서는 actionId/transitionId/opensTransition이 없는 경우 빈 문자열로 쓴다. enum 스탯 대신 수치 스탯을 쓴다. 시작 시각은 기존 값을 유지하므로 반환하지 않는다. 숨은 엔딩 조건을 공개 사실이나 추천에 누설하지 않는다. 반환 구조 외에 설명은 쓰지 않는다.'
 ].join('\n'),{brief,current:current.narrative.id==='custom-world'?{profile:current.profile,narrative:null,starts:[]}:{...current,assets:[],narrative:current.narrative}},signal,14000,undefined,false,generationSchema,'global.anthropic.claude-sonnet-4-6',{thinking:'disabled'});
 return finishProposal(current,brief,materializeProposal(current,generated.value));
}
