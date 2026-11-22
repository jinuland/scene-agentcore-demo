import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {BedrockRuntimeClient} from '@aws-sdk/client-bedrock-runtime';
import {blankCreator} from '../examples/agentcore-character-demo/creator';
import {createImageWorkflow,getImageWorkflow,publicImageWorkflow} from '../examples/agentcore-character-demo/creator-image-workflow';

test('image workflow keeps reference dependencies, emotion gates and owner isolation and reuses its request ID',async()=>{
 const objects=new Map<string,string>(),owner='b'.repeat(64),identifier=randomUUID(),reference=randomUUID(),document=blankCreator();document.narrative.id='test-world';document.narrative.characters![0].age=26;document.imageJobs=[{id:reference,characterId:'lead',kind:'character',status:'running'}];
 const send=S3Client.prototype.send,bedrockSend=BedrockRuntimeClient.prototype.send;let calls=0;
 S3Client.prototype.send=(async(command:any)=>{const key=command.input.Key;if(command instanceof GetObjectCommand){if(!objects.has(key))throw Object.assign(Error('missing'),{name:'NoSuchKey'});return{Body:{transformToString:async()=>objects.get(key)!}};}if(command instanceof PutObjectCommand){objects.set(key,String(command.input.Body));return{};}throw Error('unexpected S3 command');})as never;
 BedrockRuntimeClient.prototype.send=(async()=>{calls++;return{output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'result',name:'submit_task_result',input:{tasks:['happy','concerned'].map(emotion=>({sceneId:'opening',emotion,characterIds:['lead'],description:'도서관에서 방문자를 만나는 장면',conditions:[{counter:'hp',op:'gte',value:10}],prompt:'The same adult reference character welcomes a visitor in a moonlit library. Preserve identity and clothing from <image1>.'}))}}}]}},usage:{inputTokens:10,outputTokens:20}};})as never;
 const gpu={get:async(o:string,id:string)=>{assert.equal(o,owner);assert.equal(id,reference);return{request:{character:{id:'lead'},kind:'character'}}as any;},create:async()=>{throw Error('dependency coordinator queues only after references finish');}};
 try{const result=await createImageWorkflow('bucket',gpu,owner,identifier,document,AbortSignal.timeout(5000));assert.equal(result.tasks.length,2);assert.equal(result.status,'waiting');assert.equal(result.sources.lead.jobId,reference);assert.equal(new Set(result.tasks.map(t=>t.id)).size,2);assert.equal(result.tasks[0].conditions[0].counter,'hp');const publicResult=publicImageWorkflow(result);assert.ok(!JSON.stringify(publicResult).includes('Preserve identity'));assert.ok(!('owner'in publicResult));objects.delete('creator-jobs/workflow-pending/'+identifier+'.json');assert.deepEqual(await createImageWorkflow('bucket',gpu,owner,identifier,document,AbortSignal.timeout(5000)),result);assert.equal(calls,1);assert.equal(await getImageWorkflow('bucket','c'.repeat(64),identifier),undefined);assert.ok(objects.has('creator-jobs/workflow-pending/'+identifier+'.json'));}
 finally{S3Client.prototype.send=send;BedrockRuntimeClient.prototype.send=bedrockSend;}
});

test('image workflow rejects unknown scene identities and cannot queue foreign reference jobs',async()=>{
 const document=blankCreator(),owner='d'.repeat(64);document.imageJobs=[{id:randomUUID(),characterId:'lead',kind:'character',status:'completed'}];const send=S3Client.prototype.send;
 S3Client.prototype.send=(async()=>{throw Object.assign(Error('missing'),{name:'NoSuchKey'});})as never;
 try{await assert.rejects(createImageWorkflow('bucket',{get:async()=>undefined,create:async()=>{throw Error('never');}},owner,randomUUID(),document,AbortSignal.timeout(5000)),/현재 브라우저/);await assert.rejects(createImageWorkflow('bucket',{}as any,'bad',randomUUID(),document,AbortSignal.timeout(5000)),/소유자/);}
 finally{S3Client.prototype.send=send;}
});
