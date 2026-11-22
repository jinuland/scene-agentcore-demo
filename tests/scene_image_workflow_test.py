import copy,importlib.util,json,pathlib,unittest,uuid

path=pathlib.Path(__file__).resolve().parents[1]/'examples/agentcore-character-demo/gpu/workflows.py'
spec=importlib.util.spec_from_file_location('workflows',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Missing(Exception):
 response={'Error':{'Code':'NoSuchKey'}}
class Store:
 class exceptions:NoSuchKey=Missing
 def __init__(self):self.items={};self.puts=[]
 def get_object(self,Bucket,Key):
  if Key not in self.items:raise Missing()
  import io
  return{'Body':io.BytesIO(json.dumps(self.items[Key]).encode())}
 def put_object(self,Bucket,Key,Body,**kwargs):self.items[Key]=json.loads(Body);self.puts.append(Key)
 def head_object(self,Bucket,Key):
  if Key not in self.items:raise Missing()
  return{'ContentLength':10}
 def delete_object(self,Bucket,Key):self.items.pop(Key,None)

class WorkflowTest(unittest.TestCase):
 def setUp(self):
  self.store=Store();self.owner='a'*64;self.identifier=str(uuid.uuid4());self.ref=str(uuid.uuid4());self.task=str(uuid.uuid4());self.pointer={'owner':self.owner,'id':self.identifier};self.key=f'creator-jobs/workflows/{self.owner}/{self.identifier}.json';self.jobkey=f'creator-jobs/{self.owner}/{self.task}/state.json';self.pending=f'creator-jobs/pending/{self.task}.json'
  self.flow={'id':self.identifier,'owner':self.owner,'status':'waiting','message':'','style':'illustration','audience':'general','characters':[{'id':'lead','name':'왕자','description':'주인공','appearance':'초록 망토'}],'sources':{'lead':{'jobId':self.ref}},'tasks':[{'id':self.task,'sceneId':'desert','characterIds':['lead'],'emotion':'happy','description':'우물에서 쉬는 모습','prompt':'A single story image from <image1>.','status':'waiting','progress':0}],'images':[]}
  self.store.items[self.key]=copy.deepcopy(self.flow);self.store.items[f'creator-jobs/workflow-pending/{self.identifier}.json']=self.pointer;self.refkey=f'creator-jobs/{self.owner}/{self.ref}/state.json';self.store.items[self.refkey]={'status':'running','images':[]}
 def tick(self):module.tick(self.store,'bucket',self.pointer)
 def complete_reference(self):
  self.store.items[self.refkey]={'status':'completed','images':[{'view':'front','file':'/api/media/front'}]};self.store.items[f'creator/{self.owner}/front']={}
 def test_waits_then_queues_once_then_collects_and_finishes(self):
  self.tick();self.assertNotIn(self.jobkey,self.store.items);self.complete_reference();self.tick();job=self.store.items[self.jobkey];self.assertEqual(job['request']['referenceFiles'],['/api/media/front']);self.assertEqual(job['request']['sceneId'],'desert');self.assertEqual(job['request']['emotion'],'happy');self.assertIn(self.pending,self.store.items)
  queued_puts=self.store.puts.count(self.jobkey);self.tick();self.assertEqual(self.store.puts.count(self.jobkey),queued_puts)
  asset={'id':'scene-image','file':'/api/media/output','kind':'expression'};self.store.items[self.jobkey].update(status='completed',progress=1,images=[asset]);self.tick();flow=self.store.items[self.key];self.assertEqual(flow['status'],'completed');self.assertEqual(flow['images'],[asset]);self.assertEqual(flow['tasks'][0]['imageIds'],['scene-image']);self.assertNotIn(f'creator-jobs/workflow-pending/{self.identifier}.json',self.store.items)
 def test_reference_failure_is_not_reported_complete(self):
  self.store.items[self.refkey]['status']='failed';self.tick();self.assertEqual(self.store.items[self.key]['status'],'failed');self.assertNotIn(self.pending,self.store.items)
 def test_missing_reference_file_fails_instead_of_waiting_forever(self):
  self.complete_reference();self.store.items.pop(f'creator/{self.owner}/front');self.tick();self.assertEqual(self.store.items[self.key]['status'],'failed');self.assertNotIn(self.pending,self.store.items)
 def test_recovers_a_state_write_before_queue_write(self):
  self.complete_reference();self.tick();job=copy.deepcopy(self.store.items[self.jobkey]);self.store.items[self.key]=copy.deepcopy(self.flow);self.store.items[self.jobkey]=job;self.store.items.pop(self.pending);self.tick();self.assertIn(self.pending,self.store.items)

if __name__=='__main__':unittest.main()
