import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { advanceNarrative, compileNarrative, initialNarrativeState, narrativeContext, type NarrativeDefinition, type NarrativeState } from "../lib/platform/narrative-graph";
import { presentNarrative, resolveNarrativeChoice } from "../lib/platform/narrative-presentation";
import { runNarrativeModel } from "../cloud/runtime/scene-narrative-model";
import { draftStory, stories } from "../examples/agentcore-character-demo/stories";
import { sarangNarrative } from "../examples/agentcore-character-demo/sarang-story";
import { adoptWorldEngine } from "../examples/agentcore-character-demo/world-adoption";
import { sqliteStore } from "../examples/agentcore-character-demo/sqlite-store";
import { createSceneService } from "../examples/agentcore-character-demo/service";
import type { Episode } from "../examples/agentcore-character-demo/scene-store";

const definition = (id: string) => stories.find(s=>s.id===id)!.narrative!;
const evidence = "사용자가 직접 지금 선택하고 실행한다.";
function step(d: NarrativeDefinition, state: NarrativeState, ...events: string[]) {
  return advanceNarrative(d,state,evidence,{events:events.map(id=>({id,quote:evidence})),transition:null}).state;
}
function play(d: NarrativeDefinition, actions: string[]) {
  let state=initialNarrativeState(d);
  for(const action of actions) state=step(d,state,action);
  return state;
}

test("every built-in and a custom work has an isolated valid world, stats, active threads and authored endings",()=>{
  const custom=draftStory("custom-test",{title:"항구의 안개",name:"유나",genre:"SF",setting:"안개 낀 항구에서 잃어버린 화물표를 찾는 성인 선원들.",role:"성인 항해사",greeting:"마지막 출항표를 찾았어?",cover:"outer-rim"});
  for(const story of [...stories,custom]) {
    const d=story.narrative!, initial=initialNarrativeState(d),view=presentNarrative(d,initial);
    assert.ok(compileNarrative(d).graph.order>30,story.id);assert.ok(d.endings.length>=2,story.id);
    assert.ok(view.world.summary && view.fields.length && view.threads.some(t=>t.status==="active") && view.counters.length && view.suggestions.length,story.id);
    const idle=step(d,initial);
    assert.equal(idle.scene,initial.scene);assert.equal(idle.ending,undefined);assert.deepEqual(idle.counters,initial.counters);
    for(const lang of ["en","ja"] as const) assert.equal(presentNarrative(d,initial,{locale:lang}).graph.nodes,view.graph.nodes);
  }
  assert.equal(play(custom.narrative!,["agree-goal","take-step","review"]).ending,"chapter");
  assert.equal(play(custom.narrative!,["close"]).ending,"pause");
});

test("DynamoDB map ordering cannot change a multilingual world's identity or prevent the first turn",()=>{
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key,entry])=>[key,reorder(entry)])) : value;
  for (const story of stories) {
    const d=story.narrative!, initial=initialNarrativeState(d), decoded=reorder(d) as NarrativeDefinition;
    assert.equal(compileNarrative(decoded).hash,initial.definitionHash,story.id);
    assert.equal(step(decoded,initial).turns,1,story.id);
    assert.equal(presentNarrative(decoded,initial).sceneId,initial.scene,story.id);
  }
});

test("Star Wars progresses through preparation, escort and handoff with live choices, facts and multiple endings",()=>{
  const d=definition("outer-rim");let state=initialNarrativeState(d);
  state=step(d,state,"depart");assert.equal(state.scene,"hangar");assert.equal(state.counters.departed,0);
  state=step(d,state,"check-fuel");
  assert.ok(!presentNarrative(d,state).suggestions.some(s=>s.includes("장치를 점검")));
  state=step(d,state,"choose-detour");
  assert.match(presentNarrative(d,state).suggestions[0],/출항/);
  state=step(d,state,"depart");assert.equal(state.scene,"orbit");
  assert.ok(presentNarrative(d,state).world.facts.some(f=>f.id==="control-droid"));
  state=step(d,state,"launch-convoy");assert.equal(state.scene,"convoy");assert.equal(state.counters.convoy,6);
  assert.ok(!narrativeContext(d,state).facts.some(f=>f.id==="docked"));
  state=step(d,state,"exit");assert.equal(state.scene,"convoy");
  state=step(d,state,"protect");state=step(d,state,"exit");assert.equal(state.scene,"rendezvous");
  state=step(d,state,"count-ships");state=step(d,state,"report");
  assert.equal(state.ending,"safe-convoy");assert.equal(state.counters["safe-ships"],6);
  const view=presentNarrative(d,state);assert.equal(view.suggestions.length,0);assert.ok(view.threads.every(t=>t.status==="resolved"));
  assert.equal(play(d,["withdraw"]).ending,"withdrawn");
  state=initialNarrativeState(d);for(let i=0;i<20;i++)state=step(d,state);
  assert.equal(state.ending,"closed-hangar");
});

test("academy requires two real signal confirmations, and preparation never becomes a completed appeal",()=>{
  const d=definition("academy");let state=play(d,["agree","choose-signal"]);assert.equal(state.scene,"practice");
  state=step(d,state,"record-practice");assert.equal(state.scene,"practice");
  state=step(d,state,"repeat-signal");assert.equal(state.counters.repeats,1);
  state=step(d,state,"repeat-signal");assert.match(presentNarrative(d,state).suggestions[0],/접수대/);
  for(const action of ["record-practice","register","plan"])state=step(d,state,action);
  assert.equal(state.ending,"prepared");assert.equal(state.counters["days-left"],9);assert.match(presentNarrative(d,state).fields[0].value,/재심 전/);
  assert.ok(!presentNarrative(d,state).world.facts.some(f=>f.id==="unregistered"));
  assert.equal(play(d,["withdraw"]).ending,"pause");
});

test("record-bar letter alternatives are exclusive even in one plan and from either starting scene",()=>{
  const d=definition("girlfriend");
  for(const path of [["open-letter-at-counter"],["leave-sealed-at-counter"],["talk","open-letter"],["talk","leave-sealed"]]) {
    let state=play(d,path);assert.equal(state.scene,"music",path.join());
    assert.equal(state.counters.opened+state.counters.sealed,1);
    assert.ok(!presentNarrative(d,state).suggestions.some(s=>s.includes("편지")));
    for(const action of ["choose-song","listen","meet-again"])state=step(d,state,action);
    assert.equal(state.ending,"another-coffee");assert.equal(state.elapsedMinutes,3);
  }
  const both=step(d,initialNarrativeState(d),"open-letter-at-counter","leave-sealed-at-counter");
  assert.equal(both.counters.opened+both.counters.sealed,1);
  assert.equal(play(d,["goodbye"]).ending,"goodnight");
});

test("radio private listening never broadcasts; public and private follow-ups and farewell are separate endings",()=>{
  const d=definition("radio");
  let state=play(d,["prepare-private","listen"]);assert.equal(state.scene,"decision");assert.equal(state.counters.publish,0);
  const privateEnd=step(d,step(d,state,"keep-private"),"meet-again");assert.equal(privateEnd.ending,"another-track");assert.equal(privateEnd.counters.publish,0);
  const publicEnd=step(d,step(d,state,"broadcast"),"meet-again");assert.equal(publicEnd.ending,"public-next");assert.equal(publicEnd.counters["kept-private"],0);
  assert.equal(play(d,["goodbye"]).ending,"goodnight");
  for(let i=state.elapsedMinutes;i<12;i++)state=step(d,state);
  assert.ok(!presentNarrative(d,state).suggestions.some(s=>s.includes("송출에 동의")));
  assert.equal(step(d,state,"broadcast").counters.publish,0);
  assert.equal(step(d,state,"keep-private").scene,"closing");
});

test("a pinned existing graph receives new presentation without changing its hash or replay rules",()=>{
  const state=initialNarrativeState(sarangNarrative),before=JSON.stringify(state);
  const view=presentNarrative(sarangNarrative,state,{presentation:definition("sarang")});
  assert.ok(view.world.summary && view.threads.length && view.fields.length);
  assert.equal(view.world.version,2);assert.equal(JSON.stringify(state),before);
  assert.equal(compileNarrative(sarangNarrative).hash,state.definitionHash);
  const changed=play(sarangNarrative,["respectful-communication","share-pudding"]);
  const next=presentNarrative(sarangNarrative,changed,{presentation:definition("sarang")});
  assert.ok(!next.suggestions.some(s=>s.includes("푸딩 하나")));
});

test("authored suggestions execute their eligible action without an LLM round trip and stale actions cannot replay",async()=>{
  process.env.STUDIO_MULTI_MODEL_CHAT="true";
  const d=definition("outer-rim"),state=initialNarrativeState(d),message=d.scenes[0].choices!.find(c=>c.actionId==="check-fuel")!.text;
  const plan=resolveNarrativeChoice(d,state,message)!;assert.equal(plan.events[0].id,"check-fuel");
  const output=await runNarrativeModel({policy:"test",dialogueMode:"sonnet55",character:{id:"c",name:"나린",role:"정비사",voice:"natural",personality:d.summary!},tone:"SF",boundaries:[],visibleFacts:[],memories:[],recent:[],message,narrative:{definition:d,state}},undefined,undefined,async context=>({text:"[대사] 점검 끝났어. 이제 항로를 정하면 돼.",memories:[],usedFactIds:[]}));
  assert.equal(output.narrativeState!.counters["fuel-checked"],1);
  assert.equal(resolveNarrativeChoice(d,output.narrativeState!,message),undefined);
  const en=d.translations!.en![message];assert.equal(resolveNarrativeChoice(d,state,en,"en")!.events[0].id,"check-fuel");
  assert.equal(resolveNarrativeChoice(d,state,"점검했다면 뭐가 달라질까?"),undefined);
});

test("free-text repeats bind evidence to this input rather than a similar earlier quotation",async()=>{
  process.env.STUDIO_MULTI_MODEL_CHAT="true";process.env.STUDIO_AWS_AUTH="iam";
  const d=definition("academy"),state=play(d,["agree","choose-signal","repeat-signal"]);
  const message="정한 신호에 한 번 더 대답하고 리에와 결과를 기록한다.";
  const original=BedrockRuntimeClient.prototype.send;let calls=0;
  BedrockRuntimeClient.prototype.send=(async(command:{input:{messages:{content:{text:string}[]}[]}})=>{
    calls++;const input=JSON.parse(command.input.messages[0].content[0].text);assert.equal(input.state.counters.repeats,1);
    return {output:{message:{content:[{toolUse:{name:"story_result",input:{events:[{id:"repeat-signal"}],transition:null,memories:[]}}}]}}};
  }) as never;
  try {
    const result=await runNarrativeModel({policy:"test",dialogueMode:"sonnet5",character:{id:"c",name:"리에",role:"소환사",voice:"natural",personality:d.summary!},tone:"fantasy",boundaries:[],visibleFacts:[],memories:[],recent:[{id:"previous",role:"user",text:"정한 신호에 한 번 대답하고 리에와 결과를 기록한다."}],message,narrative:{definition:d,state}},undefined,undefined,async context=>{
      assert.match(context.visibleFacts.find(f=>f.id==="canonical-status")!.statement,/"value":2/);
      return {text:"[대사] 두 번째 신호까지 확인했어요. 기록하고 접수대로 갈 수 있어요.",memories:[],usedFactIds:[]};
    });
    assert.equal(calls,1);assert.equal(result.narrativeState!.counters.repeats,2);assert.equal(result.narrativeState!.events.at(-1)!.quote,message);
    assert.match(presentNarrative(d,result.narrativeState!).suggestions[0],/접수대/);
  } finally {BedrockRuntimeClient.prototype.send=original;}
});

test("unplayed multilingual rollout snapshots normalize their hash without inventing progress",()=>{
  const story=stories.find(s=>s.id==="outer-rim")!,state=initialNarrativeState(story.narrative!);state.definitionHash="0".repeat(64);
  const episode:Episode={id:randomUUID(),story:story.id,turns:[],memories:[],narrative:state,narrativeDefinition:story.narrative};
  const adopted=adoptWorldEngine(episode,story);assert.equal(adopted.narrative!.definitionHash,initialNarrativeState(story.narrative!).definitionHash);assert.deepEqual(adopted.narrative!.events,[]);
  const progressed={...episode,narrative:{...state,turns:1}};assert.equal(adoptWorldEngine(progressed,story),progressed);
});

test("legacy adoption preserves the transcript and verified trust without inventing historical world actions",()=>{
  const old:Episode={id:randomUUID(),story:"outer-rim",memories:[],turns:[{id:randomUUID(),input:"출항하자",text:"[대사] 점검부터 하자.",mood:"neutral",suggestions:[],mode:"sonnet5",timing:1,trustQuote:"출항하자"}]};
  const before=JSON.stringify(old),story=stories.find(s=>s.id==="outer-rim")!,current=adoptWorldEngine(old,story);
  assert.equal(JSON.stringify(old),before);assert.deepEqual(current.turns,old.turns);assert.equal(current.narrativeStartedAtTurn,1);
  assert.equal(current.narrative!.counters.trust,1);assert.equal(current.narrative!.counters.departed,0);assert.deepEqual(current.narrative!.events,[]);
  const advanced=step(current.narrativeDefinition!,current.narrative!,"check-fuel");
  const view=presentNarrative(current.narrativeDefinition!,advanced,{turnOffset:1});assert.equal(view.timeline[0].turn,2);
  assert.equal(adoptWorldEngine(current,story),current);
});

test("legacy service GET is read-only and the next leased turn atomically persists tracking and reloads it",async()=>{
  process.env.STUDIO_MULTI_MODEL_CHAT="true";
  const store=sqliteStore(join(mkdtempSync(join(tmpdir(),"world-adoption-")),"test.sqlite"));
  const handle=createSceneService({store,web:resolve("examples/agentcore-character-demo/web"),aws:{arn:"arn:aws:bedrock-agentcore:ap-northeast-2:123456789012:runtime/test_runtime",region:"ap-northeast-2"}});
  let cookie="";
  const send=async(path:string,data?:unknown)=>{
    const r=await handle(new Request("http://scene.test/api/"+path,{method:data?"POST":"GET",headers:{origin:"http://scene.test",cookie,"content-type":"application/json"},...(data?{body:JSON.stringify(data)}:{})}));cookie ||= r.headers.get("set-cookie")!.split(";")[0];return r;
  };
  await send("library");
  const owner=createHash("sha256").update(cookie.slice("scene_demo=".length)).digest("hex");
  const id=randomUUID();const old:Episode={id,story:"outer-rim",turns:[{id:randomUUID(),input:"안녕",text:"[대사] 반가워.",mood:"neutral",suggestions:[],mode:"sonnet5",timing:1}],memories:[]};await store.putEpisode(owner,old);
  const preview=await(await send(`episodes/${id}`)).json();assert.equal(preview.narrative.world.trackingSinceTurn,1);assert.deepEqual(await store.findEpisode(owner,id),old);
  const original=BedrockAgentCoreClient.prototype.send;
  BedrockAgentCoreClient.prototype.send=(async(command:{input:{payload:Uint8Array}})=>{
    const {context}=JSON.parse(Buffer.from(command.input.payload).toString());const state=advanceNarrative(context.narrative.definition,context.narrative.state,context.message,{events:[{id:"check-fuel",quote:context.message}],transition:null}).state;
    return {statusCode:200,response:{transformToString:async()=>JSON.stringify({schemaVersion:"character-turn/1",reply:{text:"[대사] 점검했어. 이제 항로를 정하면 돼.",memories:[],usedFactIds:[],narrativeState:state}})}};
  }) as never;
  try {
    const r=await send(`episodes/${id}/turn`,{message:"내 배의 연료와 항법 장치를 점검한다.",mode:"sonnet5"});assert.equal(r.status,200,await r.clone().text());const committed=await r.json();
    assert.equal(committed.version,2);assert.equal(committed.stats.trust,committed.narrative.counters.find((c:{id:string})=>c.id==="trust").value);assert.equal(committed.narrative.turns,1);assert.equal(committed.narrative.timeline[0].turn,2);assert.deepEqual(committed.turns[0],preview.turns[0]);
    assert.deepEqual(await(await send(`episodes/${id}`)).json(),committed);
    const persisted=await store.findEpisode(owner,id);assert.equal(persisted!.narrativeStartedAtTurn,1);assert.ok(persisted!.narrativeDefinition);
  } finally {BedrockAgentCoreClient.prototype.send=original;}
});
