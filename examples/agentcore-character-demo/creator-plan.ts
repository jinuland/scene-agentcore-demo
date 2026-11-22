import {z} from 'zod';
import {creatorDocumentSchema,inspectCreator,type CreatorDocument} from './creator';
import {narrativeDefinitionSchema as N} from '../../lib/platform/narrative-graph';
const id=z.string().regex(/^[a-z][a-z0-9-]{0,45}$/);
const gates=N.shape.transitions.element.shape.conditions;
export const authorPlanSchema=z.object({
 summary:z.string().min(1).max(1200),requirements:z.array(z.string().max(400)).max(24),assumptions:z.array(z.string().max(400)).max(12),
 characters:z.array(z.object({id,name:z.string().min(1).max(80),role:z.string().max(160)}).strict()).min(1).max(12),
 counters:N.shape.counters,
 actions:z.array(z.object({id,label:z.string().max(100),when:z.string().max(300),scenes:z.array(id).max(24),once:z.boolean(),effects:N.shape.events.element.shape.effects,conditions:gates}).strict()).max(20),
 scenes:z.array(z.object({id,title:z.string().max(100),speaker:id,location:z.string().max(100),objective:z.string().max(250),entry:z.string().max(350),exit:z.string().max(350),minTurns:z.number().int().min(1).max(12),completionActions:z.array(id).max(4).default([]),dependsOn:z.array(id).max(24)}).strict()).min(1).max(24),
 routes:z.array(z.object({id,from:id,to:id,label:z.string().max(120),when:z.string().max(300),conditions:gates}).strict()).max(40),
 endings:z.array(z.object({id,title:z.string().max(100),outline:z.string().max(350),scenes:z.array(id).min(1).max(24),conditions:gates.min(1),priority:z.number().int().min(0).max(100),midStory:z.boolean()}).strict()).min(1).max(10),
}).strict();
export type AuthorPlan=z.infer<typeof authorPlanSchema>;
export const foundationSchema=z.object({summary:z.string().max(1600),characters:z.array(z.object({id,voice:z.string().max(300),description:z.string().max(600),appearance:z.string().max(350)}).strict()).max(12)}).strict();
export const scenePartSchema=z.object({opening:z.string().min(1).max(1000),completion:z.string().min(1).max(350),choices:z.array(z.object({text:z.string().min(1).max(180),actionId:z.string().max(64)}).strict()).min(3).max(5)}).strict();
export const connectionSchema=z.object({prologue:z.string().min(1).max(1500),greeting:z.string().min(1).max(800),endings:z.array(z.object({id,text:z.string().min(1).max(800)}).strict()).max(10)}).strict();
export type ScenePart=z.infer<typeof scenePartSchema>;
export function validateAuthorPlan(raw:unknown):AuthorPlan{
 const p=authorPlanSchema.parse(raw),scenes=new Set(p.scenes.map(s=>s.id)),metrics=new Set(p.counters.map(c=>c.id)),actors=new Set(p.characters.map(c=>c.id));
 for(const list of [p.scenes,p.counters,p.actions,p.routes,p.endings,p.characters])if(new Set(list.map(x=>x.id)).size!==list.length)throw Error('계획의 항목 이름이 중복됩니다.');
 if(p.actions.length+p.scenes.length>32)throw Error('공통 행동과 장면 완료 행동의 합은32개 이하여야 합니다.');
 if(p.actions.some(a=>a.id.startsWith('finish-')))throw Error('finish- 접두사는 장면 완료 전용입니다.');
 for(const s of p.scenes)if(!actors.has(s.speaker)||s.dependsOn.some(x=>!scenes.has(x)))throw Error('장면의 화자 또는 선행 장면이 없습니다.');
 const done=new Set<string>();for(let pass=0;pass<p.scenes.length;pass++)for(const s of p.scenes)if(s.dependsOn.every(d=>done.has(d)))done.add(s.id);if(done.size!==scenes.size)throw Error('제작 계획에 순환 의존 관계가 있습니다.');
 const reachable=new Set([p.scenes[0].id]);for(let i=0;i<p.scenes.length;i++)for(const s of p.scenes)if(s.completionActions.some(id=>!p.actions.some(a=>a.id===id&&a.scenes.includes(s.id))))throw Error('장면 완료에 연결한 공통 행동이 없습니다.');
 for(const r of p.routes)if(reachable.has(r.from))reachable.add(r.to);if(p.scenes.some(s=>!reachable.has(s.id)))throw Error('시작점에서 연결되지 않은 장면이 있습니다.');
 for(const c of p.counters)if(c.min>c.initial||c.initial>c.max||['scene-turns','total-turns','elapsed-minutes'].includes(c.id))throw Error('계획의 스탯 범위를 확인해 주세요.');
 for(const a of p.actions)if(a.scenes.some(x=>!scenes.has(x))||a.effects.some(e=>!metrics.has(e.counter)))throw Error('행동의 장면 또는 스탯 참조가 없습니다.');
 for(const s of p.scenes)if(s.completionActions.some(id=>!p.actions.some(a=>a.id===id&&a.scenes.includes(s.id))))throw Error('장면 완료에 연결한 공통 행동이 없습니다.');
 for(const r of p.routes)if(!scenes.has(r.from)||!scenes.has(r.to)||r.from===r.to)throw Error('장면 연결을 확인해 주세요.');
 for(const e of p.endings)if(e.scenes.some(x=>!scenes.has(x)))throw Error('엔딩의 장면 참조가 없습니다.');
 for(const item of [...p.actions,...p.routes,...p.endings])for(const g of item.conditions)if(!metrics.has(g.counter)&&!['scene-turns','total-turns','elapsed-minutes'].includes(g.counter))throw Error('조건의 스탯 참조가 없습니다.');
 return p;
}
export function assembleAuthorDocument(base:CreatorDocument,p:AuthorPlan,foundation:z.infer<typeof foundationSchema>,parts:Record<string,ScenePart>,connection:z.infer<typeof connectionSchema>):CreatorDocument{
 const d=structuredClone(base),names=new Set(p.characters.map(c=>c.id));
 if(foundation.characters.length!==names.size||new Set(foundation.characters.map(c=>c.id)).size!==names.size||foundation.characters.some(c=>!names.has(c.id)))throw Error('공통 인물 구성에 빠지거나 중복된 인물이 있습니다.');
 if(connection.endings.length!==p.endings.length||new Set(connection.endings.map(e=>e.id)).size!==p.endings.length||p.endings.some(e=>!connection.endings.some(x=>x.id===e.id)))throw Error('엔딩 서술이 계획과 일치하지 않습니다.');
 const events:z.infer<typeof N.shape.events>=p.actions.map(a=>({...a,minutes:0,result:a.label}));
 const scenes=p.scenes.map(s=>{
  const part=scenePartSchema.parse(parts[s.id]);const allowed=new Set(p.actions.filter(a=>a.scenes.includes(s.id)).map(a=>a.id));allowed.add('finish-'+s.id);
  if(part.choices.some(c=>c.actionId&&!allowed.has(c.actionId)))throw Error(s.title+': 계획에 없는 행동을 추천했습니다.');
  events.push({id:'finish-'+s.id,alsoApplies:s.completionActions,label:s.title+' 마무리',when:('플레이어가 '+s.objective+' 과정을 실제로 마치고, 다음 뜻을 직접 표현한다: '+s.exit+' 질문·가정·단순 작별은 제외.').slice(0,500),scenes:[s.id],once:true,effects:[],conditions:[{counter:'scene-turns',op:'gte',value:Math.max(0,s.minTurns-1)}],minutes:0,result:s.exit});
  const choices=part.choices.filter(c=>c.actionId!=='finish-'+s.id).slice(0,4).map((c,i)=>({id:'choice-'+i,text:c.text,conditions:[],...(c.actionId?{actionId:c.actionId}:{})}));
  choices.push({id:'finish-choice',text:s.exit.slice(0,180),conditions:[{counter:'scene-turns',op:'gte',value:Math.max(0,s.minTurns-1)}] as never,actionId:'finish-'+s.id});
  return{id:s.id,speaker:s.speaker,title:s.title,location:s.location,objective:s.objective,opening:part.opening,minTurns:s.minTurns,mood:'neutral' as const,suggestions:[],choices};
 });
 const transitions=p.routes.map(r=>({...r,requiresEvents:['finish-'+r.from]}));
 // Exactly one outgoing route can be requested by a completion action. A branch requires an explicit transition selection.
 for(const e of events){const routes=transitions.filter(r=>'finish-'+r.from===e.id);if(routes.length===1)Object.assign(e,{opensTransition:routes[0].id});}
 d.narrative={...d.narrative,id:d.narrative.id==='custom-world'?'authored-world':d.narrative.id,summary:foundation.summary,startScene:p.scenes[0].id,characters:p.characters.map(c=>({...c,...foundation.characters.find(x=>x.id===c.id)!})),counters:p.counters,scenes,events,transitions,endings:p.endings.map(e=>({id:e.id,title:e.title,text:connection.endings.find(x=>x.id===e.id)!.text,scenes:e.scenes,conditions:e.conditions,priority:e.priority,...(!e.midStory?{requiresEvents:e.scenes.map(s=>'finish-'+s)}:{})})),translations:undefined};
 // A final ending spanning alternatives requires completion of its actual current scene, represented as separate rows.
 d.narrative.endings=d.narrative.endings.flatMap(e=>(e.requiresEvents?.length??0)>1?e.scenes.map((s,i)=>({...e,id:e.id+'-'+i,scenes:[s],requiresEvents:['finish-'+s]})):[e]);
 d.starts=[{id:'default',title:'기본 시작',sceneId:p.scenes[0].id,prologue:connection.prologue,greeting:connection.greeting,values:{}}];
 const checked=inspectCreator(d);if(!checked.ok)throw Error(checked.errors.slice(0,5).map(e=>e.path+': '+e.message).join('\n'));
 return creatorDocumentSchema.parse(checked.document);
}
