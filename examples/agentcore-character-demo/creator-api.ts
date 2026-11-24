import{creatorChatView,creatorChatContext,type CreatorChatStore}from'./creator-chat-store';
import {publishPublicStory,publishPublicTemplate,importPublicTemplate} from './public-stories';
import{publicImageWorkflow}from'./creator-image-workflow';
import{creatorMcpServices}from'./creator-mcp-services';
import littlePrinceExample from'./examples/little-prince.json';
import type{AuthorJobStore,AuthorQueue}from'./creator-job-store';
import{authorJobRequest,createAuthorJob,dispatchAuthorJob,publicAuthorJob,retryAuthorTask}from'./creator-jobs';
import {creatorImageModel,gpuRequestSchema,queueCreatorImage,publicGpuJob,type CreatorGpuStore} from "./creator-gpu";
import {partnerRequestSchema,partnerStateSchema,proposedSettings,runCreatorPartner} from "./creator-partner";
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
export async function creatorApi(args:{path:string;request:Request;owner:string;store:SceneStore;media?:CreatorMediaStore;gpu?:CreatorGpuStore;authorJobs?:AuthorJobStore;authorQueue?:AuthorQueue;creatorChats?:CreatorChatStore;builtins:Story[];body:(r:Request,max?:number)=>Promise<unknown>;json:(status:number,data:unknown)=>Response;publicStory:(story:Story)=>unknown;chargeGeneration?:()=>Promise<void>}){
 const {path,request,owner,store,media,builtins,body,json,publicStory}=args,method=request.method;
 const asset=/^\/api\/media\/([0-9a-f-]{36})$/u.exec(path);
 if(asset&&method==='GET'){const result=await media?.get(owner,asset[1]);if(!result)throw new StudioError(404,"이미지를 찾지 못했습니다.");return new Response(Uint8Array.from(result.bytes),{headers:{'Content-Type':result.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}});}
 if(!path.startsWith('/api/creator'))return;
 const chatPath=/^\/api\/creator\/chats\/([0-9a-f-]{36})(?:\/(export|import|applied))?$/u.exec(path);
 if(chatPath){
  if(!args.creatorChats)throw new StudioError(503,'제작 이력 저장소가 연결되어 있지 않습니다.');const threadId=z.string().uuid().parse(chatPath[1]),action=chatPath[2],records=await args.creatorChats.records(owner,threadId);
  if(method==='GET'&&!action)return json(200,creatorChatView(records));
  if(method==='GET'&&action==='export'){const response=json(200,{schema:'scene-creation-history/1',threadId,records});response.headers.set('Content-Disposition','attachment; filename="scene-creation-history.json"');return response;}
  if(method==='POST'&&action==='import'){const input=z.object({turns:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(16000),research:z.array(z.unknown()).optional(),tools:z.array(z.unknown()).optional()}).strict()).max(12),proposal:z.object({base:partnerStateSchema,changes:z.array(z.object({field:z.enum(['title','role','genre','tagline','world','flow','rules','ending']),value:z.string().max(5000),before:z.string().max(5000),reason:z.string().max(400)}).strict()).max(8)}).strict().optional()}).strict().parse(await body(request,250000));if(!records.length){let sequence=0;for(const turn of input.turns){await args.creatorChats.append(owner,{threadId,runId:'legacy',sequence:sequence++,at:new Date().toISOString(),kind:turn.role,data:{...turn,importedFromBrowser:true}});for(const t of turn.tools??[]){const tool=t as {name:string;ok:boolean;error?:string};await args.creatorChats.append(owner,{threadId,runId:'legacy',sequence:sequence++,at:new Date().toISOString(),kind:'tool_record',data:{name:tool.name,result:{isError:!tool.ok},importedFromBrowser:true,notice:'이전 브라우저의 실행 요약입니다. 도구 입력·결과 원문은 남아 있지 않습니다.'}});}}if(input.proposal){const proposal=proposedSettings(input.proposal.base,input.proposal.changes.map(({field,value,reason})=>({field,value,reason})));await args.creatorChats.append(owner,{threadId,runId:randomUUID(),sequence:0,at:new Date().toISOString(),kind:'proposal',data:{proposal,importedFromBrowser:true}});}}return json(200,creatorChatView(await args.creatorChats.records(owner,threadId)));}
  if(method==='POST'&&action==='applied'){const input=z.object({proposalRunId:z.string().uuid(),changes:z.array(z.object({field:z.enum(['title','role','genre','tagline','world','flow','rules','ending']),value:z.string().max(5000),before:z.string().max(5000).optional(),reason:z.string().max(400)}).strict()).max(8)}).strict().parse(await body(request,150000));if(!records.some(r=>r.runId===input.proposalRunId&&['proposal','assistant'].includes(r.kind)))throw new StudioError(404,'적용할 수정 제안의 제작 이력을 찾지 못했습니다.');await args.creatorChats.append(owner,{threadId,runId:randomUUID(),sequence:0,at:new Date().toISOString(),kind:'applied',data:input});return json(200,{saved:true});}
  throw new StudioError(405,'지원하지 않는 제작 이력 요청입니다.');
 }

 if(method==='GET'&&path==='/api/creator/examples/little-prince'){const shared=await store.findPublicStory?.('custom-1fa65f60-fc76-4a2b-9063-1b6022e7aad4');if(shared?.public&&shared.publicTemplate)return json(200,{document:shared.publicTemplate,sourceId:shared.id,publicTemplate:true});return json(200,{document:creatorDocumentSchema.parse(littlePrinceExample)});}
 if(method==='GET'&&path==='/api/creator/template')return json(200,{document:blankCreator()});
 if(method==='GET'&&path==='/api/creator'){
  const own=await store.drafts(owner),templates=(await store.publicStories?.()??[]).filter(s=>s.publicTemplate);return json(200,{drafts:own.filter(s=>s.creator?.status==='draft').map(s=>({id:s.id,title:s.title,revision:s.creator!.revision})),sources:[...builtins,...own.filter(s=>s.creator?.status!=='draft'&&!s.creator?.preview)].map(s=>({id:s.id,title:s.title,version:s.narrative?.version??1,custom:!!s.custom})).concat(templates.map(s=>({id:'template:'+s.id,title:'공개 초안 · '+s.title,version:s.narrative?.version??1,custom:true}))),gpu:{enabled:!!args.gpu,model:creatorImageModel.label,message:args.gpu?'Qwen-Image-2.1 · 정면 기준으로 캐릭터 동일성을 유지하며 생성합니다.':'GPU 작업자를 연결하면 기준 이미지와 감정·상황 이미지를 생성할 수 있습니다.'}});
 }
 if(path==='/api/creator/image-workflows'&&method==='POST'){
  if(!args.gpu?.createWorkflow)throw new StudioError(503,'이미지 작업자가 연결되어 있지 않습니다.');const input=z.object({requestId:z.string().uuid(),document:creatorDocumentSchema}).strict().parse(await body(request,350000));
  const result=await args.gpu.createWorkflow(owner,input.requestId,input.document,AbortSignal.any([request.signal,AbortSignal.timeout(105000)]),args.chargeGeneration);return json(202,publicImageWorkflow(result));
 }
 const imageWorkflow=/^\/api\/creator\/image-workflows\/([0-9a-f-]{36})$/u.exec(path);
 if(imageWorkflow&&method==='GET'){const result=await args.gpu?.workflow?.(owner,imageWorkflow[1]);if(!result)throw new StudioError(404,'현재 브라우저의 이미지 연결 작업을 찾지 못했습니다.');return json(200,publicImageWorkflow(result));}
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
 const publicTemplate=/^\/api\/creator\/templates\/(custom-[0-9a-f-]{36})$/u.exec(path);
 if(publicTemplate&&method==='GET'){const work=await store.findPublicStory?.(publicTemplate[1]);if(!work?.publicTemplate)throw new StudioError(404,'공개 초안을 찾지 못했습니다.');return json(200,{document:work.publicTemplate,sourceId:work.id,publicTemplate:true});}
 const source=/^\/api\/creator\/sources\/([a-z0-9-]{1,64})$/u.exec(path);
 if(source&&method==='GET'){const story=builtins.find(s=>s.id===source[1])??await store.findDraft(owner,source[1]);if(!story)throw new StudioError(404,"작품을 찾지 못했습니다.");const document=documentForStory(story);if(story.creator?.status!=='draft')delete document.creatorChatId;return json(200,{document,...(story.creator?.status==='draft'?{id:story.id,revision:story.creator.revision}:{sourceId:story.id})});}
 const gpuJob=/^\/api\/creator\/gpu\/([0-9a-f-]{36})$/u.exec(path);
 if(gpuJob&&method==='GET'){const job=await args.gpu?.get(owner,gpuJob[1]);if(!job)throw new StudioError(404,'생성 작업을 찾지 못했습니다.');return json(200,publicGpuJob(job));}
 if(method!=='POST')throw new StudioError(405,"지원하지 않는 요청입니다.");
 if(path==='/api/creator/public-templates'){const input=z.object({storyId:draftId}).strict().parse(await body(request));return json(201,{document:await publishPublicTemplate(store,media,owner,input.storyId)});}
 if(path==='/api/creator/import-template'){const input=z.object({storyId:draftId}).strict().parse(await body(request));const document=await importPublicTemplate(store,media,owner,input.storyId),id='custom-'+randomUUID(),story=storyFromDocument(document,id);story.creator={status:'draft',revision:1,sourceId:input.storyId,document};await store.putDraft(owner,story);return json(201,{id,revision:1,sourceId:input.storyId,document,imported:true});}
 if(path==='/api/creator/publications'){const input=z.object({storyId:draftId}).strict().parse(await body(request));return json(201,{story:publicStory(await publishPublicStory(store,media,owner,input.storyId))});}
 if(path==='/api/creator/gpu'){
  if(!args.gpu||!media)throw new StudioError(503,'GPU 작업자가 연결되어 있지 않습니다.');const input=gpuRequestSchema.parse(await body(request,12000));
  const existing=await args.gpu.get(owner,input.requestId);if(!existing)await args.chargeGeneration?.();
  const job=await queueCreatorImage(args.gpu,media,owner,input,AbortSignal.any([request.signal,AbortSignal.timeout(45000)]));return json(202,publicGpuJob(job));
 }
 if(path==='/api/creator/chat'){
  const input=partnerRequestSchema.parse(await body(request,250000)),threadId=input.threadId,runId=randomUUID();let sequence=0;const record=async(kind:string,data:Record<string,any>)=>{if(threadId&&args.creatorChats)await args.creatorChats.append(owner,{threadId,runId,sequence:sequence++,at:new Date().toISOString(),kind,data});};
  const previous=threadId&&args.creatorChats?await args.creatorChats.records(owner,threadId):undefined,context=previous?.length?creatorChatContext(previous):undefined;
  await record('user',{text:input.message,state:input.state});await args.chargeGeneration?.();
  const streamAbort=new AbortController(),signal=AbortSignal.any([request.signal,streamAbort.signal,AbortSignal.timeout(210000)]),services=input.document?creatorMcpServices({owner,document:input.document,activeAuthorJobId:input.activeAuthorJobId,brief:input.state.brief,webSearch:input.webSearch,jobs:args.authorJobs,queue:args.authorQueue,gpu:args.gpu,media,charge:args.chargeGeneration,signal}):undefined,encoder=new TextEncoder();
  const headers=new Headers(json(200,{}).headers);headers.set('Content-Type','text/event-stream; charset=utf-8');
  const stream=new ReadableStream<Uint8Array>({async start(controller){let open=true,pendingRecords=Promise.resolve(),partial='';const started=Date.now();
   const emit=(event:string,data:any)=>{if(event==='creator.proposal')data={...data,creationRunId:runId};if(event==='creator.delta')partial+=data.text;else if(['creator.activity','creator.tool_record','creator.proposal','creator.research','creator.artifacts'].includes(event)){pendingRecords=pendingRecords.then(()=>record(event.slice(8),data));pendingRecords.catch(()=>{});}if(event==='creator.tool_record')return;if(open)try{controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));}catch{open=false;}};
   emit('creator.activity',{message:'제작 요청을 접수했습니다. 모델과 도구를 연결합니다.'});const heartbeat=setInterval(()=>emit('creator.heartbeat',{elapsedSeconds:Math.floor((Date.now()-started)/1000)}),8000);
   try{const result=await runCreatorPartner({...input,...context},signal,emit,services);await pendingRecords;await record('assistant',{text:result.reply,...result});emit('creator.completed',{...result,creationRunId:runId,historySaved:!!(threadId&&args.creatorChats),historyRecordCount:(previous?.length??0)+sequence});}
   catch(e){const message=signal.aborted?'검색과 설정 작성이 제한 시간(3분30초)을 넘었습니다. 완료된 제안·이미지 작업은 남아 있습니다. 요청을 나누어 이어서 진행해 주세요.':e instanceof Error&&/timeout|timed out/i.test(e.message)?'도구 응답 대기 시간이 초과됐습니다. 아래 요청을 다시 보내 이어서 진행해 주세요.':e instanceof Error&&!/AccessDenied|ValidationException|Credentials|Throttling/.test(e.name)?e.message:'제작 보조 모델이나 검색 연결을 확인해 주세요.';let saved=false;try{await pendingRecords;await record('assistant',{text:partial||message,error:message});saved=!!(threadId&&args.creatorChats);}catch{}emit('creator.error',{error:message,historySaved:saved});}
   finally{clearInterval(heartbeat);if(open)controller.close();}},cancel(){streamAbort.abort();}});
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
  const data=z.object({draftId,revision:z.number().int().positive(),startId:z.string().optional(),visibility:z.enum(['private','public']).default('private')}).strict().parse(await body(request));
  const draft=await store.findDraft(owner,data.draftId);
  if(draft?.creator?.status!=='draft'||draft.creator.revision!==data.revision)throw new StudioError(409,"초안이 변경됐습니다. 저장 후 다시 시도해 주세요.");
  const checked=inspectCreator(draft.creator.document);if(!checked.ok)return json(422,{error:'작품의 필수 항목과 조건을 확인해 주세요.',...checked});
  const doc=checked.document;doc.narrative.version++;
  const paths=new Set([doc.profile.cover,...doc.assets.map(a=>a.file)]);
  for(const path of paths)if(path.startsWith('/api/media/')&&!await media?.get(owner,path.split('/').at(-1)!))throw new StudioError(422,"이 브라우저에 등록된 미디어만 사용할 수 있습니다.");
  const story=storyFromDocument(doc,'custom-'+randomUUID(),data.startId);story.creator={status:'published',revision:1,sourceId:draft.creator.sourceId,document:doc,preview:path.endsWith('/test')};
  if(Buffer.byteLength(JSON.stringify(story))>240000)throw new StudioError(413,"작품 정의가 너무 큽니다. 설정을 줄여 주세요.");
  await store.putDraft(owner,story);
  if(path.endsWith('/publish'))return json(201,{story:publicStory(data.visibility==='public'?await publishPublicStory(store,media,owner,story.id):story)});
  const episode={id:randomUUID(),story:story.id,turns:[],memories:[],storySnapshot:pinStory(story),narrativeDefinition:story.narrative,narrative:initialNarrativeState(story.narrative!)};
  await store.putEpisode(owner,episode);return json(201,{story:publicStory(story),episodeId:episode.id});
 }
 throw new StudioError(404,"제작 요청을 찾지 못했습니다.");
}
