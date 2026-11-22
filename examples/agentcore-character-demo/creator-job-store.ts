import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';import{dirname}from'node:path';
import{DynamoDBClient}from'@aws-sdk/client-dynamodb';
import{DynamoDBDocumentClient,GetCommand,PutCommand,QueryCommand}from'@aws-sdk/lib-dynamodb';
import{SQSClient,SendMessageCommand}from'@aws-sdk/client-sqs';
import type{AuthorJob,AuthorTask}from'./creator-jobs';
export interface AuthorJobStore{
 getJob(owner:string,id:string):Promise<AuthorJob|undefined>;listJobs(owner:string):Promise<AuthorJob[]>;createJob(job:AuthorJob):Promise<boolean>;
 tasks(owner:string,id:string):Promise<AuthorTask[]>;createTask(task:AuthorTask):Promise<boolean>;replaceTask(task:AuthorTask,revision:number):Promise<boolean>;
}
export type AuthorQueue=(message:{owner:string;jobId:string;taskId:string})=>Promise<void>;
export function sqsAuthorQueue(QueueUrl:string):AuthorQueue{const sqs=new SQSClient({});return async message=>{await sqs.send(new SendMessageCommand({QueueUrl,MessageBody:JSON.stringify(message)}));};}
export function sqliteAuthorJobs(path:string):AuthorJobStore{
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS author_records(owner TEXT,record TEXT,data TEXT,revision INTEGER,updated INTEGER,PRIMARY KEY(owner,record))');
 const read=(owner:string,key:string)=>{const row=db.prepare('SELECT data FROM author_records WHERE owner=? AND record=?').get(owner,key) as{data:string}|undefined;return row&&JSON.parse(row.data);};
 const list=(owner:string,prefix:string)=>db.prepare('SELECT data FROM author_records WHERE owner=? AND record LIKE ? ORDER BY updated DESC').all(owner,prefix+'%').map(r=>JSON.parse(r.data as string));
 const insert=(owner:string,key:string,data:unknown)=>!!db.prepare('INSERT OR IGNORE INTO author_records VALUES(?,?,?,?,?)').run(owner,key,JSON.stringify(data),0,Date.now()).changes;
 return{async getJob(o,id){return read(o,'author-root#'+id);},async listJobs(o){return list(o,'author-root#').slice(0,10);},async createJob(j){return insert(j.owner,'author-root#'+j.id,j);},async tasks(o,id){return list(o,'author-task#'+id+'#');},async createTask(t){return insert(t.owner,'author-task#'+t.jobId+'#'+t.id,t);},async replaceTask(t,revision){return!!db.prepare('UPDATE author_records SET data=?,revision=?,updated=? WHERE owner=? AND record=? AND revision=?').run(JSON.stringify(t),t.revision,Date.now(),t.owner,'author-task#'+t.jobId+'#'+t.id,revision).changes;}};
}
export function dynamoAuthorJobs(TableName:string):AuthorJobStore{
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
 const read=async(owner:string,record:string)=>(await db.send(new GetCommand({TableName,Key:{owner,record},ConsistentRead:true}))).Item?.data;
 const write=async(owner:string,record:string,data:unknown,revision:number,expected?:number)=>{try{await db.send(new PutCommand({TableName,Item:{owner,record,data,revision,updated:Date.now(),expires:Math.floor(Date.now()/1000)+7*86400},ConditionExpression:expected===undefined?'attribute_not_exists(#r)':'#v = :v',ExpressionAttributeNames:expected===undefined?{'#r':'record'}:{'#v':'revision'},...(expected===undefined?{}:{ExpressionAttributeValues:{':v':expected}})}));return true;}catch(e){if((e as Error).name==='ConditionalCheckFailedException')return false;throw e;}};
 const list=async(owner:string,prefix:string)=>{const items:any[]=[];let cursor:Record<string,any>|undefined;do{const p=await db.send(new QueryCommand({TableName,KeyConditionExpression:'#o=:o AND begins_with(#r,:p)',ExpressionAttributeNames:{'#o':'owner','#r':'record'},ExpressionAttributeValues:{':o':owner,':p':prefix},ConsistentRead:true,ExclusiveStartKey:cursor}));items.push(...p.Items??[]);cursor=p.LastEvaluatedKey;}while(cursor);return items.sort((a,b)=>b.updated-a.updated).map(x=>x.data);};
 return{async getJob(o,id){return await read(o,'author-root#'+id) as AuthorJob|undefined;},async listJobs(o){return(await list(o,'author-root#')).slice(0,10);},async createJob(j){return write(j.owner,'author-root#'+j.id,j,0);},async tasks(o,id){return await list(o,'author-task#'+id+'#') as AuthorTask[];},async createTask(t){return write(t.owner,'author-task#'+t.jobId+'#'+t.id,t,0);},async replaceTask(t,r){return write(t.owner,'author-task#'+t.jobId+'#'+t.id,t,t.revision,r);}};
}
