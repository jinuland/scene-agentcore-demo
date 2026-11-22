"""Install the private SCENE image worker on an existing prepared Video Lab GPU.
Deploy CDK with -c sceneGpuRole=ROLE first. No GPU instance/model provisioning.
"""
import argparse,json,pathlib,re,shlex,subprocess,tempfile,time,uuid
p=argparse.ArgumentParser();p.add_argument('--instance-id',required=True);p.add_argument('--bucket',required=True);p.add_argument('--profile',default='default');p.add_argument('--region',default='ap-northeast-2');p.add_argument('--user',default='ubuntu');p.add_argument('--python',default='/opt/scene-studio/.venv/bin/python');a=p.parse_args()
if not re.fullmatch(r'[a-z_][a-z0-9_-]*',a.user):raise ValueError('Invalid worker user')
if not re.fullmatch(r'i-[a-f0-9]{8,17}',a.instance_id)or not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]',a.bucket)or not re.fullmatch(r'/[A-Za-z0-9_./-]+',a.python):raise ValueError('Invalid deployment parameters')
def aws(service,operation,data):
 with tempfile.NamedTemporaryFile(mode='w',suffix='.json')as f:
  json.dump(data,f);f.flush();return json.loads(subprocess.check_output(['aws','--profile',a.profile,'--region',a.region,service,operation,'--cli-input-json','file://'+f.name,'--output','json'],text=True))
root=pathlib.Path(__file__).resolve().parents[1];release='creator-jobs/releases/'+str(uuid.uuid4());key=release+'/worker.py';subprocess.run(['aws','--profile',a.profile,'--region',a.region,'s3','cp',str(root/'examples/agentcore-character-demo/gpu/worker.py'),'s3://'+a.bucket+'/'+key,'--only-show-errors'],check=True)
subprocess.run(['aws','--profile',a.profile,'--region',a.region,'s3','cp',str(root/'examples/agentcore-character-demo/gpu/model.json'),'s3://'+a.bucket+'/'+release+'/model.json','--only-show-errors'],check=True)
unit='''[Unit]
Description=SCENE creator GPU image queue
After=network-online.target
[Service]
Type=simple
User=%s
WorkingDirectory=/opt/scene-studio
Environment=HF_HOME=/opt/scene-studio/data/models
Environment=AWS_DEFAULT_REGION=%s
Environment=PYTHONUNBUFFERED=1
ExecStart=%s /opt/scene-creator/worker.py --bucket %s
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
'''%(a.user,a.region,a.python,a.bucket)
import base64
commands=['set -e','if [ -e /opt/scene-creator/jobs/active ]; then echo "A creator render is active; retry after it completes. Existing work was not interrupted."; exit 2; fi',shlex.quote(a.python)+' -c '+shlex.quote('import torch,boto3,PIL; from diffusers import QwenImage21Pipeline; from runtime.drama.gpu_lease import acquire; print("GPU dependencies available")'),'mkdir -p /opt/scene-creator/jobs','chown '+shlex.quote(a.user)+' /opt/scene-creator/jobs','if [ -e /opt/scene-creator/jobs/worker.lock ]; then chown '+shlex.quote(a.user)+' /opt/scene-creator/jobs/worker.lock; fi','aws s3 cp '+shlex.quote('s3://'+a.bucket+'/'+key)+' /opt/scene-creator/worker.py --region '+shlex.quote(a.region)+' --only-show-errors','printf %s '+shlex.quote(base64.b64encode(unit.encode()).decode())+' | base64 -d > /etc/systemd/system/scene-creator-gpu.service','aws s3 cp '+shlex.quote('s3://'+a.bucket+'/'+release+'/model.json')+' /opt/scene-creator/model.json --region '+shlex.quote(a.region)+' --only-show-errors','systemctl daemon-reload','systemctl enable scene-creator-gpu.service','systemctl restart scene-creator-gpu.service','systemctl is-active scene-creator-gpu.service']
# Dependency check imports Video Lab through its existing runtime directory.
commands.insert(1,'cd /opt/scene-studio')
r=aws('ssm','send-command',{'InstanceIds':[a.instance_id],'DocumentName':'AWS-RunShellScript','Parameters':{'commands':commands,'executionTimeout':['120']}});cid=r['Command']['CommandId'];print('SSM command',cid,flush=True)
for _ in range(35):
 time.sleep(2)
 try:out=aws('ssm','get-command-invocation',{'CommandId':cid,'InstanceId':a.instance_id})
 except subprocess.CalledProcessError:continue
 if out['Status']in('Success','Failed','TimedOut','Cancelled'):
  print(out.get('StandardOutputContent',''));print(out.get('StandardErrorContent',''))
  if out['Status']!='Success':raise SystemExit(1)
  break
else:raise SystemExit('Worker installation is still running; inspect the SSM command.')
