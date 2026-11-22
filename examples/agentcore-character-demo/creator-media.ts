import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { eligibleNarrativeMedia } from "../../lib/platform/narrative-graph";
import type { Episode } from "./scene-store";
import type { Mood, Story } from "./stories";
export interface CreatorMediaStore{put(owner:string,type:string,bytes:Uint8Array):Promise<string>;get(owner:string,id:string):Promise<{type:string;bytes:Uint8Array}|undefined>}
const types={"image/webp":"webp","image/png":"png","image/jpeg":"jpg"};
export function validImage(type:string,b:Uint8Array){return type==='image/png'?Buffer.from(b.slice(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:type==='image/webp'?Buffer.from(b.slice(0,4)).toString()==='RIFF'&&Buffer.from(b.slice(8,12)).toString()==='WEBP':false;}
export function fileCreatorMedia(root:string):CreatorMediaStore{return{async put(owner,type,bytes){const id=randomUUID(),folder=join(root,owner);await mkdir(folder,{recursive:true,mode:0o700});await writeFile(join(folder,id+'.'+types[type as keyof typeof types]),bytes,{mode:0o600});return id;},async get(owner,id){for(const [type,ext]of Object.entries(types)){try{return{type,bytes:await readFile(join(root,owner,id+'.'+ext))};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}}};}
export function s3CreatorMedia(bucket:string):CreatorMediaStore{const s3=new S3Client({});return{async put(owner,type,bytes){const id=randomUUID();await s3.send(new PutObjectCommand({Bucket:bucket,Key:`creator/${owner}/${id}`,Body:bytes,ContentType:type}));return id;},async get(owner,id){try{const r=await s3.send(new GetObjectCommand({Bucket:bucket,Key:`creator/${owner}/${id}`}));return{type:r.ContentType??'image/webp',bytes:await r.Body!.transformToByteArray()};}catch(e){if(['NoSuchKey','NotFound'].includes((e as Error).name))return;throw e;}}};}
export function selectTurnMedia(story:Story,episode:Episode,mood:Mood){
  if(!story.narrative||!episode.narrative)return [];
  const rules=eligibleNarrativeMedia(story.narrative,episode.narrative).filter(rule=>(rule.eventId || rule.emotion===mood) && (!rule.characterId || rule.characterId===story.narrative!.scenes.find(s=>s.id===episode.narrative!.scene)?.speaker));
  const seen=(id:string)=>episode.turns.flatMap((t,i)=>(t.media??[]).some(m=>m.id===id)?[i+1]:[]).at(-1);
  const rule=rules.find(r=>{const last=seen(r.id);return !(r.once&&last!==undefined) && (last===undefined || episode.turns.length+1-last>r.cooldown);});
  const asset=rule&&story.media?.find(a=>a.id===rule.id);return asset?[asset]:[];
}
