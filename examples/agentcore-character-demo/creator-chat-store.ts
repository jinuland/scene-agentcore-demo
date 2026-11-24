import{DatabaseSync}from'node:sqlite';
import{mkdirSync}from'node:fs';import{dirname}from'node:path';
import{DynamoDBClient}from'@aws-sdk/client-dynamodb';
import{DynamoDBDocumentClient,PutCommand,QueryCommand}from'@aws-sdk/lib-dynamodb';
export type CreatorChatRecord={threadId:string;runId:string;sequence:number;at:string;kind:string;data:Record<string,any>};
export interface CreatorChatStore{append(owner:string,event:CreatorChatRecord):Promise<void>;records(owner:string,threadId:string):Promise<CreatorChatRecord[]>;}
const recordKey=(e:CreatorChatRecord)=>'creator-chat#'+e.threadId+'#'+e.runId+'#'+String(e.sequence).padStart(4,'0');
const order=(rows:CreatorChatRecord[])=>rows.sort((a,b)=>a.at.localeCompare(b.at)||a.runId.localeCompare(b.runId)||a.sequence-b.sequence);
export function sqliteCreatorChats(path:string):CreatorChatStore{
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS creator_chat(owner TEXT,record TEXT,data TEXT,PRIMARY KEY(owner,record))');
 return{async append(owner,event){db.prepare('INSERT OR IGNORE INTO creator_chat VALUES(?,?,?)').run(owner,recordKey(event),JSON.stringify(event));},async records(owner,id){return order(db.prepare('SELECT data FROM creator_chat WHERE owner=? AND record LIKE ?').all(owner,'creator-chat#'+id+'#%').map(r=>JSON.parse(r.data as string)));}};
}
export function dynamoCreatorChats(TableName:string):CreatorChatStore{
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
 return{async append(owner,event){await db.send(new PutCommand({TableName,Item:{owner,record:recordKey(event),data:event}}));},async records(owner,id){const rows:CreatorChatRecord[]=[];let cursor:Record<string,any>|undefined;do{const page=await db.send(new QueryCommand({TableName,KeyConditionExpression:'#o=:o AND begins_with(#r,:p)',ExpressionAttributeNames:{'#o':'owner','#r':'record'},ExpressionAttributeValues:{':o':owner,':p':'creator-chat#'+id+'#'},ConsistentRead:true,ExclusiveStartKey:cursor}));rows.push(...(page.Items??[]).map(r=>r.data as CreatorChatRecord));cursor=page.LastEvaluatedKey;}while(cursor);return order(rows);}};
}
export function creatorChatView(records:CreatorChatRecord[]){
 const turns=records.filter(r=>r.kind==='user'||r.kind==='assistant').map(r=>({role:r.kind as'user'|'assistant',text:String(r.data.text??''),...(r.data.research?{research:r.data.research}:{}),...(r.data.tools?{tools:r.data.tools}:{}),at:r.at,runId:r.runId}));
 const latest=[...records].reverse().find(r=>r.kind==='proposal'||r.kind==='assistant'&&r.data.proposal);
 const applied=latest&&records.some(r=>r.kind==='applied'&&r.data.proposalRunId===latest.runId);
 return{turns,audit:records.filter(r=>['tool_record','applied'].includes(r.kind)).map(r=>({at:r.at,kind:r.kind,...(r.kind==='tool_record'?{name:r.data.name,ok:!r.data.result?.isError}:{changes:r.data.changes})})),recordCount:records.length,proposal:applied?undefined:latest?.data.proposal,proposalRunId:latest?.runId};
}
export function creatorChatContext(records:CreatorChatRecord[]){
 const turns=creatorChatView(records).turns,history=turns.slice(-10).map(({role,text})=>({role,text:text.slice(0,16000)}));
 const archive=turns.slice(0,-10).slice(-60).map(t=>(t.role==='user'?'작가: ':'파트너: ')+t.text.slice(0,600));
 const applied=records.filter(r=>r.kind==='applied').slice(-20).map(r=>'적용한 설정: '+JSON.stringify(r.data.changes).slice(0,1600));
 return{history,archiveContext:[...archive,...applied].join('\n').slice(-28000)};
}
