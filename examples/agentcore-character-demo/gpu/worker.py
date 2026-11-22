"""Private S3 image queue; reuses an existing Video Lab GPU and its cooperative lease.
No web listener, no model download, no interruption of existing inference jobs.
"""
import argparse,datetime,fcntl,json,os,pathlib,subprocess,sys,time,uuid

def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run_queue(bucket,root):
 import boto3
 s3=boto3.client('s3');root.mkdir(parents=True,exist_ok=True)
 lock=(root/'worker.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 while True:
  try:
   pending=s3.list_objects_v2(Bucket=bucket,Prefix='creator-jobs/pending/',MaxKeys=20).get('Contents',[])
   if not pending:time.sleep(3);continue
   for item in sorted(pending,key=lambda x:x['LastModified']):
    job=json.loads(s3.get_object(Bucket=bucket,Key=item['Key'])['Body'].read());folder=root/job['id'];folder.mkdir(exist_ok=True)
    state_key=f"creator-jobs/{job['owner']}/{job['id']}/state.json"
    try:
     previous=json.loads(s3.get_object(Bucket=bucket,Key=state_key)['Body'].read())
     if previous.get('status')in('completed','failed'):
      s3.delete_object(Bucket=bucket,Key=item['Key']);continue
     (root/'active').write_text(job['id'])
     (folder/'job.json').write_text(json.dumps(job,ensure_ascii=False))
     with(folder/'worker.log').open('a')as log:
      result=subprocess.run([sys.executable,__file__,'--render',str(folder/'job.json'),'--bucket',bucket],stdout=log,stderr=subprocess.STDOUT,timeout=1800)
     if result.returncode:raise RuntimeError('이미지 모델 실행을 완료하지 못했습니다. 기준 이미지와 GPU 상태를 확인해 주세요.')
    except Exception as e:
     job.update(status='failed',message=str(e)[:300],updatedAt=now());s3.put_object(Bucket=bucket,Key=state_key,Body=json.dumps(job,ensure_ascii=False).encode(),ContentType='application/json')
    finally:
     (root/'active').unlink(missing_ok=True);s3.delete_object(Bucket=bucket,Key=item['Key'])
  except Exception as e:print(type(e).__name__,str(e)[:200],flush=True);time.sleep(5)

def render(path,bucket):
 import boto3
 from PIL import Image
 import torch
 from diffusers import QwenImage21Pipeline
 sys.path.insert(0,'/opt/scene-studio')
 from runtime.drama.gpu_lease import acquire
 job=json.loads(path.read_text());request=job['request'];folder=path.parent;s3=boto3.client('s3');state_key=f"creator-jobs/{job['owner']}/{job['id']}/state.json"
 def save(progress,message):
  job.update(status='running',progress=progress,message=message,updatedAt=now());s3.put_object(Bucket=bucket,Key=state_key,Body=json.dumps(job,ensure_ascii=False).encode(),ContentType='application/json')
 save(.02,'GPU 대기열에서 순서를 기다립니다.')
 lease=acquire(1500)
 config=json.loads(pathlib.Path(__file__).with_name('model.json').read_text())
 revision=config['revision']
 caches=[pathlib.Path('/opt/dlami/nvme/scene-models'),pathlib.Path(os.environ.get('HF_HOME','/opt/scene-studio/data/models'))/'hub']
 snapshots=[c/'models--Qwen--Qwen-Image-2.1'/'snapshots'/revision for c in caches]
 model=next((p for p in snapshots if(p/'model_index.json').exists()),None)
 if not model:raise RuntimeError('선정한 Qwen-Image-2.1 고정 버전이 GPU에 준비되어 있지 않습니다.')
 save(.05,'Qwen-Image-2.1 기준 이미지 모델을 준비합니다.')
 pipe=QwenImage21Pipeline.from_pretrained(str(model),torch_dtype=torch.bfloat16,local_files_only=True)
 pipe.enable_model_cpu_offload()
 ref=None;anchor_file=request.get('referenceFile')
 if request.get('referenceFile'):
  image_id=request['referenceFile'].rsplit('/',1)[1];ref_path=folder/'source.webp';s3.download_file(bucket,f"creator/{job['owner']}/{image_id}",str(ref_path));ref=Image.open(ref_path).convert('RGB');ref.thumbnail((config['referenceMaxEdge'],config['referenceMaxEdge']),Image.Resampling.LANCZOS)
 views=[('front','정면'),('left','왼쪽 측면'),('right','오른쪽 측면'),('back','후면'),('three-quarter','45도 모습')]if request['kind']=='character'else[('scene'if request['kind']=='scene'else'expression','장면'if request['kind']=='scene'else'상황·감정')]
 style={'anime':'high quality consistent anime character illustration','illustration':'polished storybook illustration','3d':'stylized 3D animated character render','photo':'natural photographic character portrait'}[request['style']]
 directions={'scene':'Place the reference character naturally in this full story scene: '+request['description']+'. Show the environment and story action, not a studio reference pose.', 'front':'Front-facing full body character reference, neutral expression, looking toward camera.','left':'Same character in full left side profile, entire body facing left.','right':'Same character in full right side profile, entire body facing right.','back':'Same character viewed from behind, show the back of hair and same clothing, no front face.','three-quarter':'Same character at a three-quarter 45 degree angle, full body clearly visible.','expression':'Same character and identity, show the requested emotion and situation: '+request['description']+'; emotion: '+request['emotion']+'.'}
 job['images']=[]
 for index,(view,label)in enumerate(views):
  source_reference=anchor_file
  output=folder/(view+'.webp');seed=(job['seed']+index)%2147483647
  if not output.exists():
   save(.1+.85*index/len(views),label+' 생성 중 · 기준 인물과 의상 유지')
   prompt=style+'. '+job['prompt']+'. '+directions[view]+' Preserve the reference character identity, species, age, face, hair, outfit and colors. One character only. Fully clothed. No text, watermark, collage or multiple panels.'
   if request['kind']=='character':
    prompt='Draw exactly ONE single person, ONE pose and ONE camera angle on the entire canvas. This is NOT a character sheet or turnaround sheet. '+prompt+' '+directions[view]+' Only this requested view. Center the single person on a plain neutral background. Never repeat the person, never include additional angles, panels or side-by-side figures.'
    if view!='front':prompt='Use image1 ONLY as a reference for identity and clothing. Replace its camera angle and composition completely with the requested single view. '+prompt
   def on_step(pipeline,step,timestep,callback_kwargs):
    if step%5==0:save(.1+.85*(index+(step+1)/config['steps'])/len(views),label+' 생성 중 · '+str(step+1)+'/'+str(config['steps'])+'단계')
    return callback_kwargs
   options=dict(prompt=prompt,width=config['width'],height=config['height'],num_inference_steps=config['steps'],generator=torch.Generator('cuda').manual_seed(seed),callback_on_step_end=on_step)
   if ref is not None:options['image']=[ref]
   image=pipe(**options).images[0];image.save(output,format='WEBP',quality=92)
  else:image=Image.open(output).convert('RGB')
  if index==0 and request['kind']=='character':ref=image
  image_id=str(uuid.uuid5(uuid.UUID(job['id']),view))
  if index==0 and request['kind']=='character':anchor_file='/api/media/'+image_id
  s3.upload_file(str(output),bucket,f"creator/{job['owner']}/{image_id}",ExtraArgs={'ContentType':'image/webp'})
  job['images'].append(dict(id='gpu-'+image_id[:8],file='/api/media/'+image_id,label=request['character']['name']+' · '+label,view=view if view!='expression'else None,characterId=request['character']['id'],kind='reference'if request['kind']=='character'else'expression',emotion=request['emotion'],description=request['description'],seed=seed,model=config['id']+'@'+revision,referenceFile=source_reference))
  save(.1+.85*(index+1)/len(views),label+' 생성·저장 완료')
 job.update(status='completed',progress=1,message='캐릭터 이미지가 저장되었습니다.',updatedAt=now());s3.put_object(Bucket=bucket,Key=state_key,Body=json.dumps(job,ensure_ascii=False).encode(),ContentType='application/json');lease.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--bucket',required=True);p.add_argument('--root',default='/opt/scene-creator/jobs');p.add_argument('--render');args=p.parse_args()
 if args.render:render(pathlib.Path(args.render),args.bucket)
 else:run_queue(args.bucket,pathlib.Path(args.root))
