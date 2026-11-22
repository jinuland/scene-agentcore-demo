import {createHash} from 'node:crypto';
import {GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';
import {z} from 'zod';
import type {CreatorDocument} from './creator';
import type {CreatorGpuStore} from './creator-gpu';
import {creatorOptions} from './creator-options';

const emotion=z.enum(['neutral','happy','sad','angry','focused','concerned','relieved']);
const taskSchema=z.object({sceneId:z.string(),emotion,characterIds:z.array(z.string()).min(1).max(3),description:z.string().min(5).max(400),conditions:z.array(z.object({counter:z.string(),op:z.enum(['gte','lte','eq']),value:z.number().int()}).strict()).max(4).default([]),prompt:z.string().min(10).max(1600)}).strict();
const planSchema=z.object({tasks:z.array(taskSchema).min(1).max(48)}).strict();
export type ImageWorkflowTask=z.infer<typeof taskSchema>&{id:string;title:string;mediaId:string;status:'waiting'|'queued'|'running'|'completed'|'failed';progress:number;message?:string;imageIds?:string[]};
export type ImageWorkflow={id:string;owner:string;status:'waiting'|'running'|'completed'|'failed';message:string;createdAt:string;updatedAt:string;style:string;audience:string;characters:NonNullable<CreatorDocument['narrative']['characters']>;sources:Record<string,{file?:string;jobId?:string}>;tasks:ImageWorkflowTask[];images:CreatorDocument['assets']};
const workflowKey=(owner:string,id:string)=>`creator-jobs/workflows/${owner}/${id}.json`;
const uuid=(text:string)=>{const h=createHash('sha256').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};

export async function getImageWorkflow(bucket:string,owner:string,id:string):Promise<ImageWorkflow|undefined>{
 if(!/^[a-f0-9]{64}$/u.test(owner)||!z.string().uuid().safeParse(id).success)return;
 try{const r=await new S3Client({}).send(new GetObjectCommand({Bucket:bucket,Key:workflowKey(owner,id)}));return JSON.parse(await r.Body!.transformToString());}catch(e){if(['NoSuchKey','NotFound'].includes((e as Error).name))return;throw e;}
}

export async function createImageWorkflow(bucket:string,gpu:CreatorGpuStore,owner:string,id:string,doc:CreatorDocument,signal:AbortSignal,charge?:()=>Promise<void>):Promise<ImageWorkflow>{
 if(!/^[a-f0-9]{64}$/u.test(owner)||!z.string().uuid().safeParse(id).success)throw Error('이미지 작업의 소유자·번호를 확인해 주세요.');
 const previous=await getImageWorkflow(bucket,owner,id);if(previous){if(['waiting','running'].includes(previous.status))await new S3Client({}).send(new PutObjectCommand({Bucket:bucket,Key:`creator-jobs/workflow-pending/${id}.json`,Body:JSON.stringify({owner,id}),ContentType:'application/json'}));return previous;}
 if(!doc.narrative.characters?.length||!doc.narrative.scenes.length)throw Error('등장인물과 장면 구성을 먼저 만들어 주세요.');
 const sources:ImageWorkflow['sources']={};
 for(const character of doc.narrative.characters){
  const job=[...(doc.imageJobs??[])].reverse().find(j=>j.characterId===character.id&&j.kind==='character'&&j.status!=='failed');
  if(job){const actual=await gpu.get(owner,job.id);if(!actual||actual.request.character.id!==character.id||actual.request.kind!=='character')throw Error('현재 브라우저의 기준 이미지 작업을 확인해 주세요.');sources[character.id]={jobId:job.id};}
  else {const front=doc.assets.find(a=>a.characterId===character.id&&a.kind==='reference'&&a.view==='front');if(front){const found=await new S3Client({}).send(new GetObjectCommand({Bucket:bucket,Key:`creator/${owner}/${front.file.split('/').at(-1)}`}));await found.Body?.transformToByteArray();sources[character.id]={file:front.file};}}
 }
 const characters=doc.narrative.characters.filter(c=>sources[c.id]);
 for(const scene of doc.narrative.scenes)if(!scene.speaker||!sources[scene.speaker])throw Error(scene.title+': 화자의 기준 이미지를 먼저 생성해 주세요.');
 const options=creatorOptions(doc.authoring);
 const {authorTaskModel}=await import('./creator-task-model');
 const tasks:z.infer<typeof taskSchema>[]=[];
 const scenes=doc.narrative.scenes;
 for(let offset=0;offset<scenes.length;offset+=12){
  const batches=[scenes.slice(offset,offset+6),scenes.slice(offset+6,offset+12)].filter(batch=>batch.length);
  const results=await Promise.all(batches.map(async batch=>{await charge?.();return authorTaskModel<z.infer<typeof planSchema>>({schema:planSchema,planner:false,settings:options,webSearch:false,signal,activity:async()=>{},system:'Plan two distinct emotional illustrations for EACH supplied scene. Use the exact scene IDs. Keep the actual location, situation, species, ages, clothing and authored world. Do not reveal later events in earlier scenes. characterIds must include the supplied scene speaker first, and only characters available as references. Refer to each character reference as <image1>, <image2>, <image3> in the corresponding order. The output prompt is concise English for a single story illustration, never a sheet or collage. description is Korean for the creator. Choose two different emotions that fit plausible moments within that scene. Emotions are visual expressions; do not invent extra story decisions or change numerical rules. Each English prompt should be no more than70 words and the Korean description no more than70 characters. Optional conditions may refer ONLY to supplied existing counters to keep an unrevealed event or resolution hidden; use their exact IDs and integer ranges. Never alter story state.',input:{summary:doc.narrative.summary,characters,counters:doc.narrative.counters,events:doc.narrative.events.filter(e=>e.scenes.some(id=>batch.some(s=>s.id===id))),scenes:batch.map(s=>({id:s.id,title:s.title,speaker:s.speaker,location:s.location,opening:s.opening,objective:s.objective,mood:s.mood}))}});}));
  tasks.push(...results.flatMap(r=>r.value.tasks));
 }
 const result={value:{tasks}};
 const seen=new Set<string>();
 for(const task of result.value.tasks){const scene=doc.narrative.scenes.find(s=>s.id===task.sceneId);if(!scene||task.characterIds[0]!==scene.speaker||task.characterIds.some(c=>!sources[c]))throw Error('장면 이미지 계획의 인물·장면 연결을 확인하지 못했습니다.');if(task.conditions.some(g=>{const c=doc.narrative.counters.find(c=>c.id===g.counter);return !c||g.value<c.min||g.value>c.max;}))throw Error('이미지 공개 조건의 스탯 범위를 확인하지 못했습니다.');const key=task.sceneId+'/'+task.emotion;if(seen.has(key))throw Error('장면 이미지 계획에 같은 감정이 중복되었습니다.');seen.add(key);}
 if(doc.narrative.scenes.some(s=>result.value.tasks.filter(t=>t.sceneId===s.id).length!==2))throw Error('각 장면의 두 감정 이미지 계획을 완료하지 못했습니다.');
 const reserved=(doc.imageJobs??[]).filter(j=>j.status!=='failed').reduce((n,j)=>n+Math.max(0,(j.kind==='character'?5:1)-(j.imageIds?.length??0)),0);
 if(doc.assets.length+reserved+result.value.tasks.length>120||(doc.imageJobs?.length??0)+result.value.tasks.length>80||(doc.narrative.media?.length??0)+result.value.tasks.length>80)throw Error('작품 이미지 저장 한도를 초과합니다. 이전 이미지 작업을 정리해 주세요.');
 const now=new Date().toISOString();const workflow:ImageWorkflow={id,owner,status:'waiting',message:'캐릭터 기준 이미지 완료를 기다린 뒤 장면 이미지를 자동 생성합니다.',createdAt:now,updatedAt:now,style:doc.imageStyle??'illustration',audience:options.audience,characters,sources,tasks:result.value.tasks.map((t,i)=>({...t,id:uuid(id+'/'+i),title:doc.narrative.scenes.find(s=>s.id===t.sceneId)!.title,mediaId:'scene-'+uuid(id+'/'+i).slice(0,16),status:'waiting',progress:0,message:'참조 캐릭터 이미지 완료 대기'})),images:[]};
 const s3=new S3Client({});try{await s3.send(new PutObjectCommand({Bucket:bucket,Key:workflowKey(owner,id),Body:JSON.stringify(workflow),ContentType:'application/json',IfNoneMatch:'*'}));}catch(e){if((e as {$metadata?:{httpStatusCode:number}}).$metadata?.httpStatusCode!==412)throw e;return (await getImageWorkflow(bucket,owner,id))!;}
 await s3.send(new PutObjectCommand({Bucket:bucket,Key:`creator-jobs/workflow-pending/${id}.json`,Body:JSON.stringify({owner,id}),ContentType:'application/json'}));return workflow;
}

export function publicImageWorkflow(workflow:ImageWorkflow){return{id:workflow.id,status:workflow.status,message:workflow.message,tasks:workflow.tasks.map(({prompt,...task})=>task),images:workflow.images,completed:workflow.tasks.filter(t=>t.status==='completed').length,total:workflow.tasks.length};}
