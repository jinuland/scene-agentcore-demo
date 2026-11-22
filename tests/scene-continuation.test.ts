import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {BedrockAgentCoreClient} from '@aws-sdk/client-bedrock-agentcore';
import {advanceNarrative,initialNarrativeState,compileNarrative,type NarrativeDefinition,type NarrativeState} from '../lib/platform/narrative-graph';
import {presentNarrative,resolveNarrativeChoice} from '../lib/platform/narrative-presentation';import {sceneStreamPrompt} from '../cloud/runtime/scene-stream-model';import {runtimeContextSchema} from '../lib/platform/runtime-model';
import {stories} from '../examples/agentcore-character-demo/stories';import {reunion} from '../examples/agentcore-character-demo/world-definitions';import {adoptWorldEngine} from '../examples/agentcore-character-demo/world-adoption';import {sqliteStore} from '../examples/agentcore-character-demo/sqlite-store';import {createSceneService} from '../examples/agentcore-character-demo/service';import type {Episode} from '../examples/agentcore-character-demo/scene-store';
const story=stories.find(s=>s.id==='girlfriend')!,d=story.narrative!,quote='사용자가 이번 입력에서 직접 선택하고 실행한다.';
function step(def:NarrativeDefinition,state:NarrativeState,id:string){return advanceNarrative(def,state,quote,{events:[{id,quote}],transition:null}).state;}
function play(def:NarrativeDefinition,ids:string[]){let state=initialNarrativeState(def);for(const id of ids)state=step(def,state,id);return state;}
const night=['leave-sealed-at-counter','choose-song','listen','meet-again'];

test('coffee agreement and a nightly farewell are nonterminal milestones; explicit arrival advances the day',()=>{
 let state=play(d,night);assert.equal(state.scene,'planning');assert.equal(state.ending,undefined);assert.ok(presentNarrative(d,state).milestones.some(m=>m.id==='another-coffee'));
 state=step(d,state,'arrive-cafe');assert.equal(state.scene,'planning');
 state=step(d,state,'schedule');assert.equal(state.elapsedMinutes,3);assert.equal(state.scene,'planning');assert.equal(state.counters.visited,0);
 state=step(d,state,'goodbye');assert.equal(state.scene,'between-days');assert.equal(state.ending,undefined);
 state=step(d,state,'arrive-cafe');assert.equal(state.scene,'cafe-reunion');assert.equal(state.elapsedMinutes,963);assert.equal(state.counters.sealed,1);assert.equal(state.counters.opened,0);
 assert.ok(presentNarrative(d,state).milestones.some(m=>m.id==='reunited'));assert.ok(presentNarrative(d,state).threads.some(t=>t.id==='return-record'&&t.status==='active'));
 assert.equal(step(d,initialNarrativeState(d),'goodbye').scene,'between-days');
});

test('the continuing story reaches three authored conclusions only after the appropriate choices',()=>{
 const throughArchive=[...night,'schedule','arrive-cafe','inspect-receipt','visit-locker','inspect-archive','settle-record'];
 const ready=play(d,throughArchive);assert.equal(ready.scene,'decision');assert.equal(ready.ending,undefined);assert.equal(ready.counters['archive-returned'],1);
 assert.equal(play(d,[...throughArchive,'choose-reconnect']).ending,'start-again');assert.equal(play(d,[...throughArchive,'choose-friends']).ending,'new-friends');assert.equal(play(d,['close-relationship']).ending,'separate-paths');
 assert.equal(play(d,[...night,'choose-reconnect']).ending,undefined);assert.equal(play(d,[...night,'schedule','arrive-cafe','visit-locker']).scene,'cafe-reunion');
 assert.ok(compileNarrative(d).graph.nodes().some(n=>n.startsWith('milestone/')));
});

test('a v1 ended episode upgrades without losing its original transcript, evidence, flags or clock',()=>{
 const oldDef=reunion(),state=play(oldDef,night);assert.equal(state.ending,'another-coffee');
 const old:Episode={id:randomUUID(),story:'girlfriend',turns:night.map((input,i)=>({id:'t'+i,input,text:'[대사] 기억하고 있어.',mood:'neutral',suggestions:[],mode:'grok43',timing:1})),memories:[],narrativeDefinition:oldDef,narrative:state};const before=JSON.stringify(old),updated=adoptWorldEngine(old,story);
 assert.equal(JSON.stringify(old),before);assert.deepEqual(updated.turns,old.turns);assert.deepEqual(updated.narrative!.events,state.events);assert.deepEqual(updated.narrative!.transitions,state.transitions);assert.equal(updated.narrative!.elapsedMinutes,state.elapsedMinutes);
 for(const [key,value] of Object.entries(state.counters))assert.equal(updated.narrative!.counters[key],value);
 assert.equal(updated.narrative!.scene,'planning');assert.equal(updated.narrative!.ending,undefined);assert.equal(updated.narrativeDefinition!.version,2);assert.equal(updated.narrativeUpgrade!.previousEnding,'another-coffee');assert.equal(adoptWorldEngine(updated,story),updated);
 const farewell={...old,narrative:play(oldDef,['goodbye'])};assert.equal(adoptWorldEngine(farewell,story).narrative!.scene,'between-days');
 const unknown={...old,story:'other'};assert.equal(adoptWorldEngine(unknown,{...story,id:'other'}),unknown);
});

test('length control uses one shared target for Grok and Sonnet; shorter mode remains a distinct request',()=>{
 const base={policy:'test',character:{id:'c',name:'서윤',role:'주인',voice:'natural',personality:'record bar'},tone:'romance',boundaries:[],visibleFacts:[],memories:[],recent:[],message:'오랜만이야.'};
 const grok=runtimeContextSchema.parse({...base,responseLength:'scene',dialogueMode:'grok43'}),sonnet={...grok,dialogueMode:'sonnet55' as const};assert.equal(sceneStreamPrompt(grok),sceneStreamPrompt(sonnet));assert.match(sceneStreamPrompt(grok),/550~750/);assert.match(sceneStreamPrompt({...sonnet,responseLength:'short'}),/150~300/);assert.doesNotMatch(sceneStreamPrompt({...sonnet,responseLength:'short'}),/550~750/);
 assert.equal(runtimeContextSchema.safeParse({...base,responseLength:'unknown'}).success,false);
});

test('GET reopens the old ending read-only; the next leased turn commits v2 once and reloads the same progress',async()=>{
 process.env.STUDIO_MULTI_MODEL_CHAT='true';process.env.STUDIO_MANTLE_CHAT_REGION='us-east-1';const store=sqliteStore(join(mkdtempSync(join(tmpdir(),'scene-continuation-')),'test.sqlite'));
 const handle=createSceneService({store,web:resolve('examples/agentcore-character-demo/web'),aws:{arn:'arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/test_runtime',region:'ap-northeast-2'}});let cookie='';
 const send=async(path:string,data?:unknown)=>{const r=await handle(new Request('http://scene.test/api/'+path,{method:data?'POST':'GET',headers:{origin:'http://scene.test',cookie,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}));cookie ||=r.headers.get('set-cookie')!.split(';')[0];return r;};
 await send('library');const owner=createHash('sha256').update(cookie.slice('scene_demo='.length)).digest('hex'),id=randomUUID(),oldDef=reunion();
 const old:Episode={id,story:'girlfriend',turns:night.map((input,i)=>({id:'t'+i,input,text:'[대사] 다음에 만나자.',mood:'neutral',suggestions:[],mode:'grok43',timing:1})),memories:[],narrative:play(oldDef,night),narrativeDefinition:oldDef};await store.putEpisode(owner,old);
 const preview=await(await send('episodes/'+id)).json();assert.equal(preview.narrative.ending,undefined);assert.equal(preview.narrative.sceneId,'planning');assert.deepEqual(await store.findEpisode(owner,id),JSON.parse(JSON.stringify(old)));
 const original=BedrockAgentCoreClient.prototype.send;let calls=0;
 BedrockAgentCoreClient.prototype.send=(async(command:{input:{payload:Uint8Array}})=>{calls++;const {context}=JSON.parse(Buffer.from(command.input.payload).toString());assert.equal(context.responseLength,'scene');const plan=resolveNarrativeChoice(context.narrative.definition,context.narrative.state,context.message)!;assert.equal(plan.events[0].id,'schedule');const state=advanceNarrative(context.narrative.definition,context.narrative.state,context.message,plan).state;return{statusCode:200,response:{transformToString:async()=>JSON.stringify({schemaVersion:'character-turn/1',reply:{text:'[대사] 내일 오후로 정하자. 카페에서 이어서 이야기하고 싶어.',memories:[],usedFactIds:[],narrativeState:state}})}};})as never;
 try{const request={message:d.scenes.find(s=>s.id==='planning')!.choices!.find(c=>c.actionId==='schedule')!.text,mode:'grok43',responseLength:'scene',requestId:randomUUID()};const r=await send('episodes/'+id+'/turn',request);assert.equal(r.status,200,await r.clone().text());const committed=await r.json();assert.equal(committed.narrative.ending,undefined);assert.equal(committed.turns.length,5);assert.deepEqual(committed.turns.slice(0,4),preview.turns);assert.deepEqual(await(await send('episodes/'+id)).json(),committed);assert.equal((await(await store.findEpisode(owner,id))!).narrativeDefinition!.version,2);
 assert.equal((await send('episodes/'+id+'/turn',request)).status,200);assert.equal(calls,1);assert.equal((await send('episodes/'+id+'/turn',{...request,responseLength:'short'})).status,409);
 }finally{BedrockAgentCoreClient.prototype.send=original;}
});
