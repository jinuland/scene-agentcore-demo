import type{SceneStore}from'./scene-store';
import type{Story}from'./stories';
export async function creatorVersions(store:SceneStore,owner:string){
 const drafts=(await store.drafts(owner)).filter(s=>s.creator?.status==='draft');
 const prince=drafts.filter(s=>s.title==='어린왕자의 모험').sort((a,b)=>a.creator!.revision-b.creator!.revision||a.id.localeCompare(b.id));
 const counts=new Map<string,number>();for(const s of prince)if(s.creator?.workId)counts.set(s.creator.workId,(counts.get(s.creator.workId)??0)+1);
 const shared=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0]??prince[0]?.id;
 let next=Math.max(0,...prince.map(s=>s.creator?.version??0));const used=new Set<number>();
 for(const s of [...prince.filter(s=>s.creator?.workId===shared),...prince.filter(s=>s.creator?.workId!==shared),...drafts.filter(s=>s.title!=='어린왕자의 모험')]){const c=s.creator!,isPrince=s.title==='어린왕자의 모험';let version=c.version??(isPrince?++next:1);if(isPrince&&used.has(version))version=++next;if(isPrince)used.add(version);const workId=isPrince?shared:c.workId??s.id;if(c.workId===workId&&c.version===version)continue;s.creator={...c,workId,version,savedAt:c.savedAt??new Date().toISOString()};await store.putDraft(owner,s,c.revision);}
 return drafts;
}
export function versionInventory(drafts:Story[]){const groups=new Map<string,Story[]>();for(const d of drafts){const key=d.creator!.workId??d.id;groups.set(key,[...groups.get(key)??[],d]);}return [...groups].map(([id,items])=>{items.sort((a,b)=>(b.creator!.version??1)-(a.creator!.version??1));return{id,title:items[0].title,latestId:items[0].id,versions:items.map(s=>({id:s.id,version:s.creator!.version??1,revision:s.creator!.revision,memo:s.creator!.memo??'',savedAt:s.creator!.savedAt}))};});}
