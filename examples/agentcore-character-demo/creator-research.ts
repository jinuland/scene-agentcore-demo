import {BedrockRuntimeClient,ConverseCommand} from '@aws-sdk/client-bedrock-runtime';
export type ResearchResult={summary:string;sources:{title:string;url:string}[];searchedAt:string};
export function parseResearchContent(content:unknown[]):ResearchResult{
 const sources=new Map<string,{title:string;url:string}>();const texts:string[]=[];
 const walk=(value:unknown)=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(walk);return;}const o=value as Record<string,unknown>;if(typeof o.text==='string')texts.push(o.text);const web=(o.location as {web?:{url?:string;domain?:string}}|undefined)?.web;if(web?.url){try{const u=new URL(web.url);if(u.protocol==='https:'||u.protocol==='http:')sources.set(u.href,{url:u.href,title:web.domain||u.hostname});}catch{}}for(const [key,item]of Object.entries(o))if(!['text','reasoningContent','reasoningText'].includes(key))walk(item);};
 walk(content);return{summary:[...new Set(texts)].join('\n').slice(0,12000),sources:[...sources.values()].slice(0,12),searchedAt:new Date().toISOString()};
}
export async function researchStory(query:string,signal?:AbortSignal):Promise<ResearchResult>{
 const client=new BedrockRuntimeClient({region:'us-east-1',maxAttempts:1});
 try{const r=await client.send(new ConverseCommand({modelId:'us.amazon.nova-2-lite-v1:0',messages:[{role:'user',content:[{text:'Search the web for the following fictional work / intellectual property. Prefer official publisher, creator, production and authoritative reference sources. Summarize characters, world rules, major story beats and distinguish verified canon from interpretation. Include source citations. Do not copy long passages. Query: '+query}]}],toolConfig:{tools:[{systemTool:{name:'nova_grounding'}}]},inferenceConfig:{maxTokens:2200}} as never),{abortSignal:signal});
  const result=parseResearchContent(r.output?.message?.content??[]);if(!result.sources.length)throw Error('검색에서 출처를 확보하지 못했습니다. 검색어를 작품명과 작가명으로 구체화해 주세요.');return result;
 }finally{client.destroy();}
}
