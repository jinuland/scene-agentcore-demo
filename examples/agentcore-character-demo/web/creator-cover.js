/** Choose an opening-scene illustration without replacing a manually selected cover.
 * @param {import('../creator').CreatorDocument} doc
 * @param {string=} startId
 */
export function creatorCover(doc,startId){
 if(doc.coverMode!=='auto')return doc.profile.cover;
 const scene=doc.starts.find(s=>startId?s.id===startId:true)?.sceneId??doc.narrative.startScene;
 const candidates=(doc.narrative.media??[]).filter(m=>m.scenes.includes(scene)&&!m.eventId&&!m.conditions.length).flatMap(m=>doc.assets.filter(a=>a.id===m.id&&['expression','upload'].includes(a.kind)&&a.view==='scene'));
 return candidates.find(a=>a.file===doc.profile.cover)?.file??candidates[0]?.file??doc.profile.cover;
}
