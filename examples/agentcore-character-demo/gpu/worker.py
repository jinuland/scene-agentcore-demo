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
 refs=[];anchor_file=request.get('referenceFile')
 for index,file in enumerate(request.get('referenceFiles')or([anchor_file]if anchor_file else[])):
  ref_path=folder/('source-'+str(index)+'.webp');s3.download_file(bucket,f"creator/{job['owner']}/{file.rsplit('/',1)[-1]}",str(ref_path));reference=Image.open(ref_path).convert('RGB');reference.thumbnail((config['referenceMaxEdge'],config['referenceMaxEdge']),Image.Resampling.LANCZOS);refs.append(reference)
 ref=refs[0]if refs else None
 style={'anime':'high quality consistent anime character illustration','illustration':'polished storybook illustration','3d':'stylized 3D animated character render','photo':'natural photographic character portrait'}[request['style']]
 def upload(image,view,label,reference_file=None):
  output=folder/(view+'.webp');image.save(output,format='WEBP',quality=92);image_id=str(uuid.uuid5(uuid.UUID(job['id']),view));key=f"creator/{job['owner']}/{image_id}";s3.upload_file(str(output),bucket,key,ExtraArgs={'ContentType':'image/webp'});assert s3.head_object(Bucket=bucket,Key=key)['ContentLength']==output.stat().st_size
  asset=dict(id='gpu-'+image_id[:8],file='/api/media/'+image_id,label=request['character']['name']+' · '+label,view=view,characterId=request['character']['id'],kind='reference'if request['kind']=='character'else'expression',emotion=request['emotion'],description=request['description'],seed=job['seed'],model=config['id']+'@'+revision,referenceFile=reference_file)
  if request.get('referenceFiles'):asset['referenceFiles']=request['referenceFiles']
  job['images'].append(asset);return asset
 if request['kind']=='character'and request.get('referenceLayout')=='sheet':
  job['images']=[];sheet_path=folder/'sheet.webp'
  if sheet_path.exists():sheet=Image.open(sheet_path).convert('RGB')
  else:
   prompt=style+'. '+job['prompt']+'. Create ONE character turnaround reference sheet with exactly THREE equally wide vertical panels, full body in each panel: LEFT panel front view, MIDDLE panel left side profile, RIGHT panel back view. All three depict the SAME character, same age, species, face, hair, clothing and colors. Maintain original anatomy: a flower remains a flower, an animal remains that animal, do not turn them into humans. Simple neutral background, no text, no titles, no watermarks, no panel borders. Characters are fully clothed when clothing applies. Use the reference only for identity; build the new three-panel sheet layout.'
   def sheet_step(pipeline,step,timestep,callback_kwargs):
    if step%5==0:save(.1+.8*(step+1)/config['steps'],'캐릭터 시트 한 장 생성 중 · '+str(step+1)+'/'+str(config['steps'])+'단계')
    return callback_kwargs
   options=dict(prompt=prompt,width=2048,height=1024,num_inference_steps=config['steps'],generator=torch.Generator('cuda').manual_seed(job['seed']),callback_on_step_end=sheet_step)
   if refs:options['image']=refs
   sheet=pipe(**options).images[0]
  sheet_asset=upload(sheet,'sheet','기준 시트 · 한 장');save(.92,'기준 시트 저장 완료 · 각 뷰 분리 중')
  for index,(view,label)in enumerate([('front','정면 · 시트에서 분리'),('left','측면 · 시트에서 분리'),('back','후면 · 시트에서 분리')]):upload(sheet.crop((round(index*sheet.width/3),0,round((index+1)*sheet.width/3),sheet.height)),view,label,sheet_asset['file'])
  job.update(status='completed',progress=1,renderCount=1,message='기준 시트 한 장 생성·저장 완료 · 정면·측면·후면 분리',updatedAt=now());s3.put_object(Bucket=bucket,Key=state_key,Body=json.dumps(job,ensure_ascii=False).encode(),ContentType='application/json');lease.close();return
 views=[('front','정면'),('left','왼쪽 측면'),('right','오른쪽 측면'),('back','후면'),('three-quarter','45도 모습')]if request['kind']=='character'else[('scene'if request['kind']=='scene'else'expression','장면'if request['kind']=='scene'else'상황·감정')]
 style={'anime':'high quality consistent anime character illustration','illustration':'polished storybook illustration','3d':'stylized 3D animated character render','photo':'natural photographic character portrait'}[request['style']]
 directions={'scene':'Place the reference character naturally in this full story scene: '+request['description']+'. Show the environment and story action, not a studio reference pose.', 'front':'Front-facing full body character reference, neutral expression, looking toward camera.','left':'Same character in full left side profile, entire body facing left.','right':'Same character in full right side profile, entire body facing right.','back':'Same character viewed from behind, show the back of hair and same clothing, no front face.','three-quarter':'Same character at a three-quarter 45 degree angle, full body clearly visible.','expression':'Same character and identity, show the requested emotion and situation: '+request['description']+'; emotion: '+request['emotion']+'.'}
 job['images']=[]
 for index,(view,label)in enumerate(views):
  source_reference=anchor_file
  output=folder/(view+'.webp');seed=(job['seed']+index)%2147483647
  if not output.exists():
   save(.1+.85*index/len(views),label+' 생성 중 · 기준 인물과 의상 유지')
   prompt=style+'. '+job['prompt']+'. '+directions[view]+' Preserve the reference character identity, species, age, face, hair, outfit and colors. Preserve original anatomy and species. Do not turn plants or animals into people. Clothing stays consistent when applicable. No text, watermark, collage or multiple panels.'
   if request['kind']=='character':
    prompt='Draw exactly ONE single character or subject, ONE pose and ONE camera angle on the entire canvas. This is NOT a character sheet or turnaround sheet. '+prompt+' '+directions[view]+' Only this requested view. Center the single character on a plain neutral background. Never repeat the character, never include additional angles, panels or side-by-side figures.'
    if view!='front':prompt='Use the reference image ONLY as a reference for identity and clothing. Replace its camera angle and composition completely with the requested single view. '+prompt
   def on_step(pipeline,step,timestep,callback_kwargs):
    if step%5==0:save(.1+.85*(index+(step+1)/config['steps'])/len(views),label+' 생성 중 · '+str(step+1)+'/'+str(config['steps'])+'단계')
    return callback_kwargs
   options=dict(prompt=prompt,width=config['width'],height=config['height'],num_inference_steps=config['steps'],generator=torch.Generator('cuda').manual_seed(seed),callback_on_step_end=on_step)
   if refs and request['kind']!='character':options['image']=refs
   elif ref is not None:options['image']=[ref]
   image=pipe(**options).images[0];image.save(output,format='WEBP',quality=92)
  else:image=Image.open(output).convert('RGB')
  if index==0 and request['kind']=='character':ref=image
  image_id=str(uuid.uuid5(uuid.UUID(job['id']),view))
  if index==0 and request['kind']=='character':anchor_file='/api/media/'+image_id
  s3.upload_file(str(output),bucket,f"creator/{job['owner']}/{image_id}",ExtraArgs={'ContentType':'image/webp'});assert s3.head_object(Bucket=bucket,Key=f"creator/{job['owner']}/{image_id}")['ContentLength']==output.stat().st_size
  job['images'].append(dict(id='gpu-'+image_id[:8],file='/api/media/'+image_id,label=request['character']['name']+' · '+label,view=view if view!='expression'else None,characterId=request['character']['id'],kind='reference'if request['kind']=='character'else'expression',emotion=request['emotion'],description=request['description'],seed=seed,model=config['id']+'@'+revision,referenceFile=source_reference,**({'referenceFiles':request['referenceFiles']}if request.get('referenceFiles')else{})))
  save(.1+.85*(index+1)/len(views),label+' 생성·저장 완료')
 job.update(status='completed',progress=1,message='기준 모습 5장 생성·저장 완료'if request['kind']=='character'else'장면·감정 이미지 생성·저장 완료',updatedAt=now());s3.put_object(Bucket=bucket,Key=state_key,Body=json.dumps(job,ensure_ascii=False).encode(),ContentType='application/json');lease.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--bucket',required=True);p.add_argument('--root',default='/opt/scene-creator/jobs');p.add_argument('--render');args=p.parse_args()
 if args.render:render(pathlib.Path(args.render),args.bucket)
 else:run_queue(args.bucket,pathlib.Path(args.root))
