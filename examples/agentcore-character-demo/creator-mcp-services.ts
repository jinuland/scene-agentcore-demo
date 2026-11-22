import{randomUUID}from'node:crypto';
import{z}from'zod';
import type{CreatorDocument}from'./creator';
import{creatorOptions}from'./creator-options';
import{queueCreatorImage,publicGpuJob,type CreatorGpuStore,type GpuRequest}from'./creator-gpu';
import type{CreatorMediaStore}from'./creator-media';
import type{AuthorJobStore,AuthorQueue}from'./creator-job-store';
import{createAuthorJob,dispatchAuthorJob,publicAuthorJob}from'./creator-jobs';
export const characterToolSchema=z.object({characterId:z.string().max(64).optional(),name:z.string().min(1).max(80),age:z.number().int().min(0).max(10000).optional(),role:z.string().max(160),voice:z.string().max(300),description:z.string().max(600),appearance:z.string().min(5).max(350),generateImages:z.boolean()}).strict();
export const sceneImageToolSchema=z.object({sceneIds:z.array(z.string().max(64)).min(1).max(8),characterId:z.string().max(64).optional(),emotion:z.enum(['neutral','happy','sad','angry','focused','concerned','relieved']),description:z.string().max(600)}).strict();
export type CreatorArtifact={kind:'character'|'image';character?:NonNullable<CreatorDocument['narrative']['characters']>[number];job?:ReturnType<typeof publicGpuJob>;media?:NonNullable<CreatorDocument['narrative']['media']>[number]};
export type CreatorMcpServices=ReturnType<typeof creatorMcpServices>;
export function creatorMcpServices(args:{owner:string;document:CreatorDocument;activeAuthorJobId?:string;brief:NonNullable<CreatorDocument['authorBrief']>;webSearch:boolean;jobs?:AuthorJobStore;queue?:AuthorQueue;gpu?:CreatorGpuStore;media?:CreatorMediaStore;charge?:()=>Promise<void>;signal:AbortSignal}){
 const doc=structuredClone(args.document),artifacts:CreatorArtifact[]=[],queuedCharacters=new Set<string>();let authorJob:ReturnType<typeof publicAuthorJob>|undefined;
 const options=creatorOptions(doc.authoring);
 const capacity=(count:number)=>{if((doc.imageJobs?.length??0)+artifacts.filter(a=>a.job).length>=80)throw Error('이미지 작업은 작품당80개까지 보관합니다.');const pending=(doc.imageJobs??[]).filter(j=>['queued','running'].includes(j.status)).reduce((n,j)=>n+(j.kind==='character'?5:1),0)+artifacts.reduce((n,a)=>n+(a.job?(a.job.kind==='character'?5:1):0),0);if(doc.assets.length+pending+count>120)throw Error('작품 이미지120장 한도를 초과합니다. 기존 이미지 작업을 확인해 주세요.');};
 const queueImage=async(request:GpuRequest)=>{if(!args.gpu||!args.media)throw Error('이미지 작업자가 연결되어 있지 않습니다.');await args.charge?.();return publicGpuJob(await queueCreatorImage(args.gpu,args.media,args.owner,request,args.signal));};
 const characters=()=>[...(doc.narrative.characters??[]),...artifacts.flatMap(a=>a.character?[a.character]:[])];
 return{artifacts,get authorJob(){return authorJob;},read(){return{authoring:options,characters:characters(),scenes:doc.narrative.scenes.map(s=>({id:s.id,title:s.title,speaker:s.speaker,opening:s.opening})),references:doc.assets.filter(a=>a.kind==='reference'),imageJobs:doc.imageJobs??[],imageGenerationEnabled:!!args.gpu};},
 async generateStory(){if(!args.jobs||!args.queue)throw Error('이야기 제작 작업자가 연결되어 있지 않습니다.');if(authorJob)return authorJob;if(args.activeAuthorJobId){const previous=await args.jobs.getJob(args.owner,args.activeAuthorJobId);if(previous){const view=publicAuthorJob(previous,await args.jobs.tasks(args.owner,previous.id));if(view.status==='running'){authorJob=view;return{id:view.id,status:view.status,notice:'진행 중인 제작 작업을 이어서 확인합니다.'};}}}const job=await createAuthorJob(args.jobs,args.owner,{requestId:randomUUID(),document:doc,brief:args.brief,webSearch:args.webSearch});await dispatchAuthorJob(args.jobs,args.queue,job);authorJob=publicAuthorJob(job,await args.jobs.tasks(args.owner,job.id));return{id:authorJob.id,status:authorJob.status,notice:'작업 진행 패널에서 이어서 확인합니다.'};},
 async character(raw:z.infer<typeof characterToolSchema>){
  const input=characterToolSchema.parse(raw),old=input.characterId?characters().find(c=>c.id===input.characterId):undefined;
  if(input.characterId&&!old)throw Error('현재 작품의 캐릭터를 선택해 주세요.');
  if(options.audience==='mature'&&(old?.age??input.age??0)<18)throw Error('생성할 인물의 나이 설정을 확인해 주세요.');
  const character=old??{id:'character-'+randomUUID().slice(0,8),name:input.name,age:input.age,role:input.role,voice:input.voice,description:input.description,appearance:input.appearance};
  if(!old&&characters().length>=12)throw Error('등장인물은12명까지 등록할 수 있습니다.');
  if(artifacts.some(a=>a.character?.id===character.id)||queuedCharacters.has(character.id))throw Error('이 인물은 이미 생성 요청했습니다.');
  const artifact:CreatorArtifact={kind:'character',...(!old?{character}:{})};
  if(input.generateImages){capacity(5);if((doc.imageJobs??[]).some(j=>j.characterId===character.id&&['queued','running'].includes(j.status)))throw Error('이 캐릭터는 이미 생성 중입니다.');const front=doc.assets.find(a=>a.characterId===character.id&&a.kind==='reference'&&a.view==='front');artifact.job=await queueImage({requestId:randomUUID(),kind:'character',referenceLayout:doc.referenceLayout??'sheet',character:{id:character.id,name:character.name,description:character.description,appearance:character.appearance},style:doc.imageStyle??'illustration',emotion:'neutral',description:character.appearance,audience:options.audience,preset:options.preset,...(front?{referenceFile:front.file}:{})});}
  artifacts.push(artifact);if(artifact.job)queuedCharacters.add(character.id);return artifact;
 },
 async sceneImages(raw:z.infer<typeof sceneImageToolSchema>){
  const input=sceneImageToolSchema.parse(raw);if(new Set(input.sceneIds).size!==input.sceneIds.length)throw Error('장면은 한 번씩 선택해 주세요.');capacity(input.sceneIds.length);
  const requests=input.sceneIds.map(id=>{const scene=doc.narrative.scenes.find(s=>s.id===id);if(!scene)throw Error('현재 작품의 장면을 선택해 주세요.');const character=characters().find(c=>c.id===(input.characterId??scene.speaker));if(!character)throw Error(scene.title+': 등장인물을 먼저 등록해 주세요.');const front=doc.assets.find(a=>a.characterId===character.id&&a.kind==='reference'&&a.view==='front');if(!front)throw Error(character.name+'의 정면 기준 이미지를 먼저 생성하고 저장해 주세요.');return{scene,character,front};});
  const queued:CreatorArtifact[]=[];for(const{scene,character,front}of requests){const job=await queueImage({requestId:randomUUID(),kind:'scene',sceneId:scene.id,character:{id:character.id,name:character.name,description:character.description,appearance:character.appearance},style:doc.imageStyle??'illustration',emotion:input.emotion,description:(scene.title+'. '+scene.opening+' '+input.description).slice(0,600),referenceFile:front.file,audience:options.audience,preset:options.preset});const artifact:CreatorArtifact={kind:'image',job,media:{id:'image-'+randomUUID().slice(0,8),characterId:character.id,emotion:input.emotion,when:(input.description||scene.objective).slice(0,400),scenes:[scene.id],conditions:[],priority:60,once:false,cooldown:2}};artifacts.push(artifact);queued.push(artifact);}return queued;
 },
 async status(kind:'story'|'image',id:string){if(!z.string().uuid().safeParse(id).success)throw Error('작업 번호를 확인해 주세요.');if(kind==='story'){const job=await args.jobs?.getJob(args.owner,id);if(!job)throw Error('현재 브라우저의 작업을 찾지 못했습니다.');return publicAuthorJob(job,await args.jobs!.tasks(args.owner,id));}const job=await args.gpu?.get(args.owner,id);if(!job)throw Error('현재 브라우저의 이미지 작업을 찾지 못했습니다.');return publicGpuJob(job);}
 };
}
