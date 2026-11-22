import {creatorCover} from './web/creator-cover.js';
import { z } from "zod";
import {creatorOptionsSchema} from "./creator-options";
import { dialogueModeSchema } from "../../lib/platform/dialogue-modes";
import { compileNarrative, initialNarrativeState, narrativeDefinitionSchema, type NarrativeDefinition } from "../../lib/platform/narrative-graph";
import type { Story } from "./stories";
const id=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u);
// Media stays in an owner-scoped object store; executable URLs and embedded data are never accepted.
export const creatorAssetPath=z.string().regex(/^\/(?:art\/[a-z-]+\.webp|api\/media\/[0-9a-f-]{36})$/u);
export const creatorDocumentSchema=z.object({
  schema:z.literal("scene-creator/1"),
  authoring:creatorOptionsSchema.optional(),
  authorBrief:z.object({world:z.string().max(5000),flow:z.string().max(5000),rules:z.string().max(5000),ending:z.string().max(3000)}).strict().optional(),
  profile:z.object({title:z.string().trim().min(1).max(48),tagline:z.string().max(300),genre:z.enum(["판타지","SF","로맨스","BL"]),role:z.string().min(1).max(120),cover:creatorAssetPath,model:dialogueModeSchema,responseLength:z.enum(["scene","short"])}).strict(),
  narrative:narrativeDefinitionSchema,
  starts:z.array(z.object({id,title:z.string().min(1).max(80),sceneId:id,prologue:z.string().min(1).max(2000),greeting:z.string().min(1).max(1000),values:z.record(z.string(),z.number().finite())}).strict()).min(1).max(8),
  assets:z.array(z.object({id,file:creatorAssetPath,label:z.string().min(1).max(150),characterId:id.optional(),kind:z.enum(['reference','expression','upload']).optional(),view:z.string().max(30).optional(),emotion:z.string().max(30).optional(),description:z.string().max(600).optional(),seed:z.number().int().optional(),model:z.string().max(200).optional(),referenceFile:creatorAssetPath.optional(),referenceFiles:z.array(creatorAssetPath).max(3).optional()}).strict()).max(120),
  referenceLayout:z.enum(['sheet','separate']).optional(),
  autoSceneImages:z.boolean().optional(),
  coverMode:z.enum(['auto','manual']).optional(),
  imageWorkflow:z.object({id:z.string().uuid(),status:z.enum(['planning','waiting','running','completed','failed']),message:z.string().max(600).optional(),total:z.number().int().min(0).max(48).optional(),completed:z.number().int().min(0).max(48).optional(),startedAt:z.string().optional()}).strict().optional(),
  imageStyle:z.enum(['anime','illustration','3d','photo']).optional(),
  imageJobs:z.array(z.object({id:z.string().uuid(),characterId:id,kind:z.enum(['character','expression','scene']),referenceLayout:z.enum(['sheet','separate']).optional(),targetMediaId:id.optional(),imageIds:z.array(id).max(12).optional(),status:z.enum(['queued','running','completed','failed']),message:z.string().max(600).optional(),progress:z.number().min(0).max(1).optional()}).strict()).max(80).optional(),
}).strict();
export type CreatorDocument=z.infer<typeof creatorDocumentSchema>;
export function documentForStory(story:Story):CreatorDocument {
  if(story.creator?.document)return structuredClone(story.creator.document);
  const narrative=structuredClone(story.narrative!);
  narrative.characters ??= [{id:"lead",name:story.character,role:story.job,voice:story.voice,description:story.setting,appearance:""}];
  for(const scene of narrative.scenes)scene.speaker ??= narrative.characters[0].id;
  narrative.media ??=[];
  const assets:CreatorDocument["assets"]=[];
  for(const [emotion,card]of Object.entries(story.cards))if(emotion!=="neutral" && card){const id="card-"+emotion;assets.push({id,file:card.file,label:card.label});narrative.media.push({id,emotion:emotion as NonNullable<NarrativeDefinition["media"]>[number]["emotion"],when:card.when??card.label,scenes:[],conditions:[],priority:30,once:false,cooldown:2});}
  return {schema:"scene-creator/1",coverMode:'manual',profile:{title:story.title,tagline:story.tagline.slice(0,300),genre:story.genre,role:story.role,cover:story.cover,model:"sonnet55",responseLength:"scene"},narrative,starts:[{id:"default",title:"기본 시작",sceneId:narrative.startScene,prologue:story.prologue,greeting:story.greeting,values:{}}],assets};
}
export function inspectCreator(raw:unknown){
  const parsed=creatorDocumentSchema.safeParse(raw);
  if(!parsed.success)return {ok:false as const,errors:parsed.error.issues.map(e=>({path:e.path.join("."),message:e.message})),warnings:[] as string[]};
  const doc=parsed.data,d=doc.narrative,errors:{path:string;message:string}[]=[],warnings:string[]=[];
  const error=(path:string,message:string)=>errors.push({path,message});
  if(!d.summary?.trim())error("narrative.summary","세계관과 규칙을 작성해 주세요.");
  if(!d.characters?.length)error("narrative.characters","등장인물을 한 명 이상 등록해 주세요.");
  for(const [i,scene]of d.scenes.entries())for(const key of ["title","location","opening","objective"] as const)if(!scene[key].trim())error(`narrative.scenes.${i}.${key}`,"장면의 제목·장소·상황·목표를 작성해 주세요.");
  for(const [i,event]of d.events.entries())if(!event.when.trim())error(`narrative.events.${i}.when`,"행동이 성립하는 입력을 설명해 주세요.");
  for(const [i,transition]of d.transitions.entries())if(!transition.when.trim())error(`narrative.transitions.${i}.when`,"전이를 실행하는 의사나 행동을 설명해 주세요.");
  for(const [i,ending]of d.endings.entries())if(!ending.title.trim()||!ending.text.trim())error(`narrative.endings.${i}`,"엔딩 제목과 확정할 결과를 작성해 주세요.");
  for(const [i,fact]of d.facts.entries())if(!fact.text.trim())error(`narrative.facts.${i}.text`,"설정 내용을 작성해 주세요.");
  const starts=new Set<string>(),assets=new Set<string>();
  for(const [i,start]of doc.starts.entries()){
    if(starts.has(start.id))error(`starts.${i}.id`,"시작 ID가 중복됩니다.");starts.add(start.id);
    if(!d.scenes.some(s=>s.id===start.sceneId))error(`starts.${i}.sceneId`,"시작 장면이 없습니다.");
    for(const [key,value]of Object.entries(start.values)){const c=d.counters.find(c=>c.id===key);if(!c || value<c.min || value>c.max || c.values && !Number.isInteger(value))error(`starts.${i}.values.${key}`,"초기값이 스탯의 범위와 맞지 않습니다.");}
  }
  for(const [i,a]of doc.assets.entries()){if(assets.has(a.id))error(`assets.${i}.id`,"미디어 ID가 중복됩니다.");assets.add(a.id);}
  for(const [i,m]of (d.media??[]).entries())if(!assets.has(m.id))error(`narrative.media.${i}`,"미디어 파일을 등록해 주세요.");
  for(const [i,a]of d.events.entries())for(const e of a.effects){const c=d.counters.find(c=>c.id===e.counter);if(c?.values&&!Number.isInteger(e.delta))error(`narrative.events.${i}.effects`,"선택형 상태는 정수 단계로 변경해야 합니다.");}
  for(const list of [d.transitions,d.endings,d.facts,d.events,...(d.statusFields??[]).map(f=>f.cases)])for(const item of list)for(const c of item.conditions??[]){const metric=d.counters.find(m=>m.id===c.counter);if(metric && (c.op==='gte'&&c.value>metric.max || c.op==='lte'&&c.value<metric.min || c.op==='eq'&&(c.value<metric.min||c.value>metric.max)))error("narrative.conditions",`${metric.label}: 범위를 벗어나 충족할 수 없는 조건입니다.`);}
  let graph;
  try{graph=compileNarrative(d).graph;for(const start of doc.starts)initialNarrativeState(startDefinition(doc,start.id));}
  catch(e){error("narrative",e instanceof Error?e.message:"세계 그래프를 구성하지 못했습니다.");}
  const reachable=new Set(doc.starts.map(s=>s.sceneId));let changed=true;while(changed){changed=false;for(const t of d.transitions)if(reachable.has(t.from)&&!reachable.has(t.to)){reachable.add(t.to);changed=true;}}
  for(const s of d.scenes)if(!reachable.has(s.id))warnings.push(`시작점에서 연결되지 않은 장면: ${s.title}`);
  for(const e of d.endings)if(!e.scenes.some(s=>reachable.has(s)))error("narrative.endings",`연결되지 않은 엔딩: ${e.title}`);
  for(const scene of d.scenes)if(!d.transitions.some(t=>t.from===scene.id)&&!d.endings.some(e=>e.scenes.includes(scene.id)))warnings.push(`출구나 엔딩이 없는 장면: ${scene.title}`);
  if(JSON.stringify(doc).length>100000)error("document","작품 정의는 100,000자 이내로 구성해 주세요.");
  if(errors.length)return{ok:false as const,errors,warnings};
  return{ok:true as const,errors,warnings,document:doc,graph:{nodes:graph!.export().nodes.map(n=>({id:n.key,kind:n.attributes!.kind})),edges:graph!.export().edges.map(e=>({from:e.source,to:e.target,kind:e.attributes!.kind}))}};
}
export function startDefinition(doc:CreatorDocument,startId=doc.starts[0].id):NarrativeDefinition{
  const start=doc.starts.find(s=>s.id===startId);if(!start)throw Error("시작 설정을 찾지 못했습니다.");
  const d=structuredClone(doc.narrative);d.startScene=start.sceneId;
  for(const c of d.counters)if(start.values[c.id]!==undefined)c.initial=start.values[c.id];
  return d;
}
export function storyFromDocument(doc:CreatorDocument,storyId:string,startId?:string):Story{
  const d=startDefinition(doc,startId),start=doc.starts.find(s=>s.sceneId===d.startScene && (!startId||s.id===startId))!,scene=d.scenes.find(s=>s.id===d.startScene)!,actor=d.characters?.find(c=>c.id===scene.speaker)??d.characters?.[0];
  if(!actor)throw Error("등장인물을 한 명 이상 등록해 주세요.");
  const cover=creatorCover(doc,startId);
  return{id:storyId,custom:true,title:doc.profile.title,tagline:doc.profile.tagline,genre:doc.profile.genre,role:doc.profile.role,cover,scene:scene.title,prologue:start.prologue,greeting:start.greeting,character:actor.name,job:actor.role,voice:actor.voice,setting:d.summary??actor.description,facts:[],suggestions:scene.choices?.slice(0,3).map(c=>c.text)??scene.suggestions,cards:{neutral:{file:cover,label:doc.profile.title}},media:doc.assets,playSettings:{model:doc.profile.model,responseLength:doc.profile.responseLength,starts:doc.starts.map(s=>({id:s.id,title:s.title}))},narrative:d};
}
export function pinStory(story:Story):Story{
  const copy=structuredClone(story);if(copy.creator)delete copy.creator.document;return copy;
}
export function blankCreator():CreatorDocument{return{schema:'scene-creator/1',coverMode:'auto',profile:{title:'새 작품',tagline:'',genre:'판타지',role:'이야기에 참여하는 방문자',cover:'/art/academy-cover.webp',model:'sonnet55',responseLength:'scene'},narrative:{id:'custom-world',version:1,startScene:'opening',startTime:'2026-03-16T12:00:00+09:00',minutesPerTurn:1,summary:'이 작품의 세계 규칙과 현재 갈등을 작성해 주세요.',characters:[{id:'lead',name:'주인공',role:'플레이어와 대화하는 인물',voice:'상황에 맞는 자연스러운 말투',description:'인물의 목표와 성격을 작성해 주세요.',appearance:''}],counters:[{id:'hp',label:'HP',initial:100,min:0,max:100,unit:'',visible:true},{id:'closed',label:'회차 마무리',initial:0,min:0,max:1,unit:'',visible:false}],facts:[],scenes:[{id:'opening',speaker:'lead',title:'첫 만남',location:'이야기의 시작 장소',opening:'지금 일어난 일과 아직 해결되지 않은 갈등을 작성해 주세요.',objective:'서로 원하는 것을 확인하기',minTurns:1,suggestions:[],choices:[{id:'ask',text:'지금 무슨 일이 있었는지 이야기해 줘.',conditions:[]},{id:'finish',text:'오늘 이야기는 여기까지 마무리할게.',conditions:[],actionId:'finish'}],mood:'neutral'}],events:[{id:'finish',label:'오늘 이야기 마무리',when:'플레이어가 오늘 이야기를 끝내겠다고 직접 선택한다.',scenes:['opening'],once:true,effects:[{counter:'closed',delta:1}],conditions:[],minutes:0}],transitions:[],endings:[{id:'closed',title:'오늘의 이야기',text:'두 사람은 오늘의 대화를 마무리했다.',scenes:['opening'],conditions:[{counter:'closed',op:'gte',value:1}],priority:50}],media:[],statusFields:[],plotThreads:[],milestones:[]},starts:[{id:'default',title:'기본 시작',sceneId:'opening',prologue:'장소와 인물, 플레이어가 지금 선택할 이유를 짧게 보여 주세요.',greeting:'왔구나. 잠깐 이야기할 수 있을까?',values:{}}],assets:[]};}
