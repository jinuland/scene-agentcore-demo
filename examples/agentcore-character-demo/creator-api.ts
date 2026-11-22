import littlePrinceExample from'./examples/little-prince.json';
import type{AuthorJobStore,AuthorQueue}from'./creator-job-store';
import{authorJobRequest,createAuthorJob,dispatchAuthorJob,publicAuthorJob,retryAuthorTask}from'./creator-jobs';
import {gpuRequestSchema,queueCreatorImage,publicGpuJob,type CreatorGpuStore} from "./creator-gpu";
import {partnerRequestSchema,runCreatorPartner} from "./creator-partner";
import {assistCreator,authorBriefSchema} from "./creator-assist";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { advanceNarrative, availableNarrativeActions, initialNarrativeState, narrativeStateSchema } from "../../lib/platform/narrative-graph";
import { presentNarrative } from "../../lib/platform/narrative-presentation";
import { StudioError } from "../../lib/studio/store";
import { creatorDocumentSchema, blankCreator, documentForStory, inspectCreator, pinStory, startDefinition, storyFromDocument, type CreatorDocument } from "./creator";
import { validImage, type CreatorMediaStore } from "./creator-media";
import type { SceneStore } from "./scene-store";
import type { Story } from "./stories";
const draftId=z.string().regex(/^custom-[0-9a-f-]{36}$/u);
export async function creatorApi(args:{path:string;request:Request;owner:string;store:SceneStore;media?:CreatorMediaStore;gpu?:CreatorGpuStore;authorJobs?:AuthorJobStore;authorQueue?:AuthorQueue;builtins:Story[];body:(r:Request,max?:number)=>Promise<unknown>;json:(status:number,data:unknown)=>Response;publicStory:(story:Story)=>unknown;chargeGeneration?:()=>Promise<void>}){
 const {path,request,owner,store,media,builtins,body,json,publicStory}=args,method=request.method;
 const asset=/^\/api\/media\/([0-9a-f-]{36})$/u.exec(path);
 if(asset&&method==='GET'){const result=await media?.get(owner,asset[1]);if(!result)throw new StudioError(404,"이미지를 찾지 못했습니다.");return new Response(Uint8Array.from(result.bytes),{headers:{'Content-Type':result.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}
 if(!path.startsWith('/api/creator'))return;
 if(method==='GET'&&path==='/api/creator/examples/little-prince')return json(200,{document:creatorDocumentSchema.parse(littlePrinceExample)});
 if(method==='GET'&&path==='/api/creator/template')return json(200,{document:blankCreator()});
 if(method==='GET'&&path==='/api/creator'){
  const own=await store.drafts(owner);return json(200,{drafts:own.filter(s=>s.creator?.status==='draft').map(s=>({id:s.id,title:s.title,revision:s.creator!.revision})),sources:[...builtins,...own.filter(s=>s.creator?.status!=='draft'&&!s.creator?.preview)].map(s=>({id:s.id,title:s.title,version:s.narrative?.version??1,custom:!!s.custom})),gpu:{enabled:!!args.gpu,model:args.gpu?'FLUX.2 klein 4B':undefined,message:args.gpu?'기존 영상랩 GPU 대기열에 연결되어 있습니다.':'GPU 작업자를 연결하면 기준 이미지와 감정·상황 이미지를 생성할 수 있습니다.'}});
 }
 if(path==='/api/creator/jobs'&&method==='POST'){
  if(!args.authorJobs||!args.authorQueue)throw new StudioError(503,'제작 작업자가 연결되어 있지 않습니다.');
  const input=authorJobRequest.parse(await body(request,250000));const job=await createAuthorJob(args.authorJobs,owner,input);await dispatchAuthorJob(args.authorJobs,args.authorQueue,job);return json(202,publicAuthorJob(job,await args.authorJobs.tasks(owner,job.id)));
 }
 const authorJob=/^\/api\/creator\/jobs\/([0-9a-f-]{36})(?:\/retry)?$/u.exec(path);
 if(authorJob){
  if(!args.authorJobs||!args.authorQueue)throw new StudioError(503,'제작 작업자가 연결되어 있지 않습니다.');const job=await args.authorJobs.getJob(owner,authorJob[1]);if(!job)throw new StudioError(404,'제작 작업을 찾지 못했습니다.');
  if(method==='POST'&&path.endsWith('/retry')){const data=z.object({taskId:z.string().max(70)}).strict().parse(await body(request));await retryAuthorTask(args.authorJobs,args.authorQueue,job,data.taskId);}
  else if(method==='GET'&&!path.endsWith('/retry'))await dispatchAuthorJob(args.authorJobs,args.authorQueue,job);
  else throw new StudioError(405,'지원하지 않는 요청입니다.');
  return json(200,publicAuthorJob(job,await args.authorJobs.tasks(owner,job.id)));
 }
 const source=/^\/api\/creator\/sources\/([a-z0-9-]{1,64})$/u.exec(path);
 if(source&&method==='GET'){const story=builtins.find(s=>s.id===source[1])??await store.findDraft(owner,source[1]);if(!story)throw new StudioError(404,"작품을 찾지 못했습니다.");return json(200,{document:documentForStory(story),...(story.creator?.status==='draft'?{id:story.id,revision:story.creator.revision}:{sourceId:story.id})});}
 const gpuJob=/^\/api\/creator\/gpu\/([0-9a-f-]{36})$/u.exec(path);
 if(gpuJob&&method==='GET'){const job=await args.gpu?.get(owner,gpuJob[1]);if(!job)throw new StudioError(404,'생성 작업을 찾지 못했습니다.');return json(200,publicGpuJob(job));}
 if(method!=='POST')throw new StudioError(405,"지원하지 않는 요청입니다.");
 if(path==='/api/creator/gpu'){
  if(!args.gpu||!media)throw new StudioError(503,'GPU 작업자가 연결되어 있지 않습니다.');const input=gpuRequestSchema.parse(await body(request,12000));
  const existing=await args.gpu.get(owner,input.requestId);if(!existing)await args.chargeGeneration?.();
  const job=await queueCreatorImage(args.gpu,media,owner,input,AbortSignal.any([request.signal,AbortSignal.timeout(45000)]));return json(202,publicGpuJob(job));
 }
 if(path==='/api/creator/chat'){
  const input=partnerRequestSchema.parse(await body(request,250000));await args.chargeGeneration?.();
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(105000)]),encoder=new TextEncoder();
  const headers=new Headers(json(200,{}).headers);headers.set('Content-Type','text/event-stream; charset=utf-8');
  const stream=new ReadableStream<Uint8Array>({async start(controller){let open=true;const emit=(event:string,data:unknown)=>{if(open)try{controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));}catch{open=false;}};try{const result=await runCreatorPartner(input,signal,emit);emit('creator.completed',result);}catch(e){const message=e instanceof Error&&!/AccessDenied|ValidationException|Credentials|Throttling/.test(e.name)?e.message:'제작 보조 모델이나 검색 연결을 확인해 주세요.';emit('creator.error',{error:message});}finally{if(open)controller.close();}},cancel(){}});
  return new Response(stream,{headers});
 }
 if(path==='/api/creator/assist'){
  const data=z.object({document:creatorDocumentSchema,brief:authorBriefSchema}).strict().parse(await body(request,250000));
  await args.chargeGeneration?.();
  const document=await assistCreator(data.document,data.brief,AbortSignal.any([request.signal,AbortSignal.timeout(100000)]));
  return json(200,{document});
 }
 if(path==='/api/creator/media'){
  if(!media)throw new StudioError(503,"이미지 저장소가 연결되어 있지 않습니다.");
  const data=z.object({type:z.enum(['image/webp','image/png','image/jpeg']),data:z.string().max(950000)}).strict().parse(await body(request,1000000));
  if(!/^[A-Za-z0-9+/]+={0,2}$/u.test(data.data))throw new StudioError(400,"이미지 데이터를 확인해 주세요.");
  const bytes=Buffer.from(data.data,'base64');if(bytes.length>700000||!validImage(data.type,bytes))throw new StudioError(400,"PNG·JPEG·WebP 이미지를 700KB 이하로 등록해 주세요.");
  const id=await media.put(owner,data.type,bytes);return json(201,{file:'/api/media/'+id});
 }
 if(path==='/api/creator/drafts'){
  const data=z.object({id:draftId.optional(),revision:z.number().int().positive().optional(),sourceId:z.string().max(64).optional(),document:z.record(z.string(),z.unknown())}).strict().parse(await body(request,250000));
  if(JSON.stringify(data.document).length>100000)throw new StudioError(413,"작품 초안이 너무 큽니다.");
  if(data.id && !data.revision)throw new StudioError(409,"초안 버전을 확인해 주세요.");
  const key=data.id??'custom-'+randomUUID(),doc=data.document as unknown as CreatorDocument;
  // Incomplete drafts remain private, inert data until validation and publication.
  const draft:Story={id:key,custom:true,title:String(doc.profile?.title??'새 작품').slice(0,48),genre:'SF',tagline:'',role:'',scene:'',prologue:'',greeting:'',cover:'/art/outer-cover.webp',character:'',job:'',voice:'',setting:'',facts:[],suggestions:[],cards:{neutral:{file:'/art/outer-cover.webp',label:'초안'}},creator:{status:'draft',revision:(data.revision??0)+1,sourceId:data.sourceId,document:doc}};
  await store.putDraft(owner,draft,data.id?data.revision:undefined);return json(200,{id:key,revision:draft.creator!.revision});
 }
 if(path==='/api/creator/validate'||path==='/api/creator/simulate'){
  const data=z.object({document:z.unknown(),startId:z.string().optional(),state:narrativeStateSchema.optional(),actionId:z.string().optional(),transitionId:z.string().optional()}).strict().parse(await body(request,250000));
  const checked=inspectCreator(data.document);if(!checked.ok)return json(200,checked);
  if(path.endsWith('/validate'))return json(200,checked);
  const def=startDefinition(checked.document,data.startId);let state=data.state??initialNarrativeState(def),applied:string[]=[];
  if(data.actionId||data.transitionId){const quote='제작자가 규칙 시뮬레이션에서 실행함';const result=advanceNarrative(def,state,quote,{events:data.actionId?[{id:data.actionId,quote}]:[],transition:data.transitionId?{id:data.transitionId,quote}:null});state=result.state;applied=result.applied;}
  return json(200,{state,narrative:presentNarrative(def,state),actions:state.ending?[]:availableNarrativeActions(def,state).map(a=>({id:a.id,label:a.label??a.id})),transitions:state.ending?[]:def.transitions.filter(t=>t.from===state.scene).map(t=>({id:t.id,label:t.label})),applied});
 }
 if(path==='/api/creator/publish'||path==='/api/creator/test'){
  const data=z.object({draftId,revision:z.number().int().positive(),startId:z.string().optional()}).strict().parse(await body(request));
  const draft=await store.findDraft(owner,data.draftId);
  if(draft?.creator?.status!=='draft'||draft.creator.revision!==data.revision)throw new StudioError(409,"초안이 변경됐습니다. 저장 후 다시 시도해 주세요.");
  const checked=inspectCreator(draft.creator.document);if(!checked.ok)return json(422,{error:'작품의 필수 항목과 조건을 확인해 주세요.',...checked});
  const doc=checked.document;doc.narrative.version++;
  const paths=new Set([doc.profile.cover,...doc.assets.map(a=>a.file)]);
  for(const path of paths)if(path.startsWith('/api/media/')&&!await media?.get(owner,path.split('/').at(-1)!))throw new StudioError(422,"이 브라우저에 등록된 미디어만 사용할 수 있습니다.");
  const story=storyFromDocument(doc,'custom-'+randomUUID(),data.startId);story.creator={status:'published',revision:1,sourceId:draft.creator.sourceId,document:doc,preview:path.endsWith('/test')};
  if(Buffer.byteLength(JSON.stringify(story))>240000)throw new StudioError(413,"작품 정의가 너무 큽니다. 설정을 줄여 주세요.");
  await store.putDraft(owner,story);
  if(path.endsWith('/publish'))return json(201,{story:publicStory(story)});
  const episode={id:randomUUID(),story:story.id,turns:[],memories:[],storySnapshot:pinStory(story),narrativeDefinition:story.narrative,narrative:initialNarrativeState(story.narrative!)};
  await store.putEpisode(owner,episode);return json(201,{story:publicStory(story),episodeId:episode.id});
 }
 throw new StudioError(404,"제작 요청을 찾지 못했습니다.");
}
