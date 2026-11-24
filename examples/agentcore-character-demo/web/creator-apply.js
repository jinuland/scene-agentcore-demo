// Keep files uploaded while generation was running, but retain the compiler's repaired bindings.
export function applyAuthorProposal(proposal,current){
 return {...proposal,creatorChatId:current.creatorChatId,assets:current.assets.map(asset=>{
  const compiled=proposal.assets.find(a=>a.id===asset.id);
  return compiled?{...asset,characterId:compiled.characterId}:asset;
 }),imageJobs:current.imageJobs?.map(job=>{
  const compiled=proposal.imageJobs?.find(j=>j.id===job.id);
  return compiled?{...job,characterId:compiled.characterId}:job;
 })};
}
