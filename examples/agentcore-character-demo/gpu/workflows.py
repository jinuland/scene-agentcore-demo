"""Durable reference dependencies. Runs separately from the GPU renderer; no model calls."""
import argparse,datetime,json,time,uuid

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(s3,bucket,key):
 try:return json.loads(s3.get_object(Bucket=bucket,Key=key)['Body'].read())
 except s3.exceptions.NoSuchKey:return None
def write(s3,bucket,key,value,**extra):s3.put_object(Bucket=bucket,Key=key,Body=json.dumps(value,ensure_ascii=False).encode(),ContentType='application/json',**extra)

def tick(s3,bucket,pointer):
 owner,identifier=pointer['owner'],pointer['id'];key=f'creator-jobs/workflows/{owner}/{identifier}.json';flow=read(s3,bucket,key)
 if not flow:return
 job_cache={};changed=False
 def job(identifier):
  if identifier not in job_cache:job_cache[identifier]=read(s3,bucket,f'creator-jobs/{owner}/{identifier}/state.json')
  return job_cache[identifier]
 for task in flow['tasks']:
  if task['status'] in ('completed','failed'):continue
  existing=job(task['id'])
  if existing:
   if existing['status']=='queued'and task['status']=='waiting':write(s3,bucket,f"creator-jobs/pending/{task['id']}.json",existing)
   task.update(status=existing['status'],progress=existing.get('progress',0),message=existing.get('message',''),imageIds=[a['id']for a in existing.get('images',[])])
   if existing['status']=='completed':
    for asset in existing.get('images',[]):
     if not any(a['id']==asset['id'] for a in flow['images']):flow['images'].append(asset)
   changed=True;continue
  refs=[];failed=False
  for cid in task['characterIds']:
   source=flow['sources'][cid];file=source.get('file')
   if not file and source.get('jobId'):
    reference=job(source['jobId'])
    if reference and reference['status']=='failed':failed=True;break
    if not reference or reference['status']!='completed':break
    file=next((a['file']for a in reference.get('images',[])if a.get('view')=='front'),None)
    if not file:failed=True;break
   if not file:break
   # Only already-persisted, owner-scoped objects become references.
   try:s3.head_object(Bucket=bucket,Key=f"creator/{owner}/{file.rsplit('/',1)[-1]}")
   except Exception as error:
    if getattr(error,'response',{}).get('Error',{}).get('Code')in('404','NoSuchKey','NotFound'):failed=True;break
    raise
   refs.append(file)
  if failed:task.update(status='failed',message='참조 캐릭터 생성이 실패했습니다.');changed=True;continue
  if len(refs)!=len(task['characterIds']):continue
  character=next(c for c in flow['characters']if c['id']==task['characterIds'][0]);request={'requestId':task['id'],'kind':'scene','sceneId':task['sceneId'],'character':{k:character.get(k,'')for k in('id','name','description','appearance')},'style':flow['style'],'audience':flow['audience'],'emotion':task['emotion'],'description':task['description'],'referenceFile':refs[0],'referenceFiles':refs}
  queued={'id':task['id'],'owner':owner,'request':request,'prompt':task['prompt'],'seed':uuid.UUID(task['id']).int%2147483647,'status':'queued','createdAt':now(),'updatedAt':now(),'progress':0,'images':[],'workflowId':identifier,'model':'Qwen-Image-2.1'}
  write(s3,bucket,f"creator-jobs/{owner}/{task['id']}/state.json",queued,IfNoneMatch='*')
  write(s3,bucket,f"creator-jobs/pending/{task['id']}.json",queued)
  task.update(status='queued',message='참조 이미지 준비 완료 · 장면 생성 대기');changed=True
 terminal=all(t['status']in('completed','failed')for t in flow['tasks']);flow['status']=('failed'if any(t['status']=='failed'for t in flow['tasks'])else'completed')if terminal else'running'
 flow['message']='장면 이미지 생성·저장을 완료했습니다.'if flow['status']=='completed'else'실패한 참조 또는 장면 이미지 작업을 확인해 주세요.'if terminal else'준비된 캐릭터 이미지를 참조해 장면별 이미지를 이어 만들고 있습니다.'
 if changed:flow['updatedAt']=now();write(s3,bucket,key,flow)
 if terminal:s3.delete_object(Bucket=bucket,Key=f'creator-jobs/workflow-pending/{identifier}.json')

def run(bucket):
 import boto3
 s3=boto3.client('s3')
 while True:
  try:
   for page in s3.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix='creator-jobs/workflow-pending/'):
    for item in page.get('Contents',[]):
     try:tick(s3,bucket,read(s3,bucket,item['Key']))
     except Exception as error:print(type(error).__name__,str(error)[:200],flush=True)
  except Exception as error:print(type(error).__name__,str(error)[:200],flush=True)
  time.sleep(5)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--bucket',required=True);run(parser.parse_args().bucket)
