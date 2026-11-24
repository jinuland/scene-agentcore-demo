import {StudioError} from '../../lib/studio/store';
import type {SceneStore} from './scene-store';
import type {CreatorMediaStore} from './creator-media';
import type {Story} from './stories';
import type {CreatorDocument} from './creator';

// This namespace cannot equal a visitor's SHA-256 session owner.
export const PUBLIC_STORY_OWNER='scene-public-catalog';
export const publicMediaRoute=/^\/api\/published\/(custom-[0-9a-f-]{36})\/media\/([0-9a-f-]{36})$/u;
export function storyMediaPaths(story:Story){return new Set([story.cover,...Object.values(story.cards).map(c=>c.file),...(story.prologueImages??[]).map(a=>a.file),...(story.media??[]).map(a=>a.file),...(story.publicTemplate?[story.publicTemplate.profile.cover,...story.publicTemplate.assets.flatMap(a=>[a.file,...(a.referenceFile?[a.referenceFile]:[]),...(a.referenceFiles??[])])]:[])]);}

/** Copy only playable artwork and definitions; author notes, reference sheets and chats stay private. */
export async function publishPublicStory(store:SceneStore,media:CreatorMediaStore|undefined,owner:string,id:string):Promise<Story>{
 const source=await store.findDraft(owner,id);
 if(source?.creator?.status!=='published'||source.creator.preview)throw new StudioError(404,'내가 등록한 작품만 공개 게시할 수 있습니다.');
 if(!store.findPublicStory||!store.putPublicStory)throw new StudioError(503,'공개 작품 저장소가 연결되어 있지 않습니다.');
 const previous=await store.findPublicStory(id);if(previous)return previous;
 const story=structuredClone(source),used=new Set(story.narrative?.media?.map(m=>m.id)??[]);
 story.media=(story.media??[]).filter(a=>used.has(a.id));
 const paths=storyMediaPaths(story),mapped=new Map<string,string>();
 for(const file of paths){
  if(file.startsWith('/art/')){mapped.set(file,file);continue;}
  if(!media)throw new StudioError(503,'공개 이미지 저장소가 연결되어 있지 않습니다.');
  let found;
  if(/^\/api\/media\/[0-9a-f-]{36}$/u.test(file))found=await media.get(owner,file.split('/').at(-1)!);
  else {const match=publicMediaRoute.exec(file),original=match&&await store.findPublicStory(match[1]);if(original&&storyMediaPaths(original).has(file))found=await media.get(PUBLIC_STORY_OWNER,match![2]);}
  if(!found)throw new StudioError(422,'공개할 작품의 이미지 파일을 확인해 주세요.');
  const copied=await media.put(PUBLIC_STORY_OWNER,found.type,found.bytes);mapped.set(file,`/api/published/${id}/media/${copied}`);
 }
 const path=(file:string)=>mapped.get(file)??file;
 story.cover=path(story.cover);for(const card of Object.values(story.cards))card.file=path(card.file);
 story.prologueImages=story.prologueImages?.map(a=>({...a,file:path(a.file)}));
 story.media=story.media.map(a=>({id:a.id,file:path(a.file),label:a.label}));
 const original=source.creator.document;
 let document:CreatorDocument|undefined;
 if(original){document={schema:original.schema,profile:{...original.profile,cover:story.cover},coverMode:original.coverMode,narrative:structuredClone(original.narrative),starts:structuredClone(original.starts),assets:original.assets.filter(a=>used.has(a.id)||paths.has(a.file)).map(a=>({id:a.id,file:path(a.file),label:a.label,kind:a.kind,view:a.view,characterId:a.characterId,emotion:a.emotion}))};}
 story.creator={status:'published',revision:source.creator.revision,...(document?{document}:{})};story.public=true;
 if(Buffer.byteLength(JSON.stringify(story))>350000)throw new StudioError(413,'공개 작품 정의가 너무 큽니다. 설정을 줄여 주세요.');
 try{await store.putPublicStory(story);}catch(error){const existing=await store.findPublicStory(id);if(existing)return existing;throw error;}
 return story;
}

/** Explicitly share a reusable creation draft, including character artwork but never job IDs or chat history. */
export async function publishPublicTemplate(store:SceneStore,media:CreatorMediaStore|undefined,owner:string,id:string):Promise<CreatorDocument>{
 const source=await store.findDraft(owner,id);if(source?.creator?.status!=='published'||source.creator.preview||!source.creator.document)throw new StudioError(404,'내가 등록한 작품의 초안만 공유할 수 있습니다.');
 if(!store.putPublicTemplate||!media)throw new StudioError(503,'공개 초안 저장소가 연결되어 있지 않습니다.');
 const published=await publishPublicStory(store,media,owner,id);if(published.publicTemplate)return structuredClone(published.publicTemplate);
 const doc=structuredClone(source.creator.document);delete doc.imageJobs;delete doc.imageWorkflow;doc.autoSceneImages=false;
 const mapped=new Map<string,string>();mapped.set(source.cover,published.cover);
 for(const a of source.media??[]){const copied=published.media?.find(p=>p.id===a.id);if(copied)mapped.set(a.file,copied.file);}
 const files=new Set([doc.profile.cover,...doc.assets.flatMap(a=>[a.file,...(a.referenceFile?[a.referenceFile]:[]),...(a.referenceFiles??[])])]);
 for(const file of files){if(mapped.has(file))continue;if(file.startsWith('/art/')){mapped.set(file,file);continue;}let found;
  if(/^\/api\/media\/[0-9a-f-]{36}$/u.test(file))found=await media.get(owner,file.split('/').at(-1)!);
  else{const match=publicMediaRoute.exec(file),work=match&&await store.findPublicStory?.(match[1]);if(work&&storyMediaPaths(work).has(file))found=await media.get(PUBLIC_STORY_OWNER,match![2]);}
  if(!found)throw new StudioError(422,'초안에 포함된 이미지를 확인해 주세요.');const copied=await media.put(PUBLIC_STORY_OWNER,found.type,found.bytes);mapped.set(file,`/api/published/${id}/media/${copied}`);
 }
 const path=(file:string)=>mapped.get(file)??file;doc.profile.cover=path(doc.profile.cover);doc.assets=doc.assets.map(a=>({...a,file:path(a.file),...(a.referenceFile?{referenceFile:path(a.referenceFile)}:{}),...(a.referenceFiles?{referenceFiles:a.referenceFiles.map(path)}:{})}));
 if(Buffer.byteLength(JSON.stringify({...published,publicTemplate:doc}))>350000)throw new StudioError(413,'공개 초안이 너무 큽니다. 불필요한 설정을 줄여 주세요.');
 try{await store.putPublicTemplate(id,doc);}catch(error){const existing=await store.findPublicStory?.(id);if(existing?.publicTemplate)return structuredClone(existing.publicTemplate);throw error;}
 return doc;
}

/** Each visitor receives owned image copies and a new private draft. Shared data is never edited. */
export async function importPublicTemplate(store:SceneStore,media:CreatorMediaStore|undefined,owner:string,id:string):Promise<CreatorDocument>{
 const story=await store.findPublicStory?.(id);if(!story?.publicTemplate||!story.public)throw new StudioError(404,'공개 초안을 찾지 못했습니다.');if(!media)throw new StudioError(503,'이미지 저장소가 연결되어 있지 않습니다.');
 const doc=structuredClone(story.publicTemplate),mapped=new Map<string,string>();const files=new Set([doc.profile.cover,...doc.assets.flatMap(a=>[a.file,...(a.referenceFile?[a.referenceFile]:[]),...(a.referenceFiles??[])])]);
 for(const file of files){if(file.startsWith('/art/')){mapped.set(file,file);continue;}const match=publicMediaRoute.exec(file);if(!match||!storyMediaPaths(story).has(file))throw new StudioError(422,'공개 초안의 이미지 연결을 확인해 주세요.');const found=await media.get(PUBLIC_STORY_OWNER,match[2]);if(!found)throw new StudioError(422,'공개 초안 이미지를 찾지 못했습니다.');mapped.set(file,'/api/media/'+await media.put(owner,found.type,found.bytes));}
 const path=(file:string)=>mapped.get(file)??file;doc.profile.cover=path(doc.profile.cover);doc.assets=doc.assets.map(a=>({...a,file:path(a.file),...(a.referenceFile?{referenceFile:path(a.referenceFile)}:{}),...(a.referenceFiles?{referenceFiles:a.referenceFiles.map(path)}:{})}));delete doc.imageJobs;delete doc.imageWorkflow;doc.autoSceneImages=false;return doc;
}
