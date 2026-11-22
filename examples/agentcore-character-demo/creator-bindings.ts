import type {CreatorDocument} from './creator';

// Resolve only identities we can establish. Never erase a scope or condition to make a rule pass.
export function preserveCreatorBindings(base:CreatorDocument,next:CreatorDocument):CreatorDocument{
 const d=structuredClone(next),normalize=(s:string)=>s.normalize('NFKC').replace(/\s+/gu,'').toLocaleLowerCase();
 const identity=(old:{id:string;name?:string;title?:string;label?:string},items:{id:string;name?:string;title?:string;label?:string}[])=>{
  if(items.some(x=>x.id===old.id))return old.id;
  const name=old.name??old.title??old.label;
  const matches=name?items.filter(x=>normalize(x.name??x.title??x.label??'')===normalize(name)):[];
  return matches.length===1?matches[0].id:undefined;
 };
 const actors=new Map((base.narrative.characters??[]).map(c=>[c.id,identity(c,d.narrative.characters??[])]));
 const scenes=new Map(base.narrative.scenes.map(s=>[s.id,identity(s,d.narrative.scenes)]));
 if(base.narrative.id==='custom-world'&&base.narrative.characters?.length===1&&base.narrative.characters[0].id==='lead'){
  actors.set('lead',d.narrative.scenes.find(s=>s.id===d.narrative.startScene)?.speaker);
  if(base.narrative.scenes.length===1)scenes.set(base.narrative.startScene,d.narrative.startScene);
 }
 const counters=new Map(base.narrative.counters.map(c=>[c.id,identity(c,d.narrative.counters)]));
 const events=new Map(base.narrative.events.map(e=>[e.id,identity(e,d.narrative.events)]));
 const resolve=(map:Map<string,string|undefined>,value:string,kind:string,label:string)=>{
  const mapped=map.get(value);if(mapped)return mapped;
  throw Error(`이미지 ‘${label}’의 ${kind} 연결을 찾지 못했습니다 (${value}). 캐릭터·미디어에서 연결을 확인한 뒤 다시 구성해 주세요. 기존 이미지는 보존됩니다.`);
 };
 d.narrative.media=(base.narrative.media??[]).map(m=>({...m,
  ...(m.characterId?{characterId:resolve(actors,m.characterId,'캐릭터',m.id)}:{}),
  ...(m.eventId?{eventId:resolve(events,m.eventId,'행동',m.id)}:{}),
  scenes:m.scenes.map(s=>resolve(scenes,s,'장면',m.id)),
  conditions:m.conditions.map(c=>({...c,counter:['scene-turns','total-turns','elapsed-minutes'].includes(c.counter)?c.counter:resolve(counters,c.counter,'스탯',m.id)})),
 }));
 d.assets=base.assets.map(a=>({...a,...(a.characterId?{characterId:resolve(actors,a.characterId,'캐릭터',a.label)}:{})}));
 d.imageJobs=base.imageJobs?.map(j=>({...j,characterId:resolve(actors,j.characterId,'캐릭터',j.id)}));
 return d;
}
