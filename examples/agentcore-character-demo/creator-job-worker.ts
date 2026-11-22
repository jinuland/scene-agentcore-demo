import{dynamoAuthorJobs,sqsAuthorQueue}from'./creator-job-store';
import{executeAuthorTask}from'./creator-jobs';
import{dailyTurnQuota}from'./dynamo-store';
import{z}from'zod';
const message=z.object({owner:z.string().regex(/^[a-f0-9]{64}$/),jobId:z.string().uuid(),taskId:z.string().regex(/^[a-z][a-z0-9-]{0,70}$/)}).strict();
export async function handler(event:{Records:{body:string}[]}){
 const table=process.env.CHARACTER_DEMO_TABLE!,queue=process.env.CHARACTER_DEMO_AUTHOR_QUEUE!;
 const store=dynamoAuthorJobs(table),send=sqsAuthorQueue(queue),charge=dailyTurnQuota(table);
 for(const record of event.Records)await executeAuthorTask(store,send,message.parse(JSON.parse(record.body)),{charge});
}
