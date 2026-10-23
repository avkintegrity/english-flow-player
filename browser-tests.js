import {openLibrary} from './db.js';
import {createBackup,readBackup,checksum} from './backup.js';
const output=document.querySelector('#results');output.textContent='';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const results=[];
const check=async(name,fn)=>{try{await fn();results.push('PASS '+name);}catch(e){results.push('FAIL '+name+': '+e.message);console.error(e);}output.textContent=results.join('\n');};
const dbName='english-flow-test-'+crypto.randomUUID();
let library;
const blob=new Blob(['synthetic audio test bytes'],{type:'audio/wav'});
await check('Migrate original v1 without losing Blob or metadata',async()=>{
 await new Promise((resolve,reject)=>{
  const r=indexedDB.open(dbName,1);r.onerror=()=>reject(r.error);
  r.onupgradeneeded=()=>{const tracks=r.result.createObjectStore('tracks',{keyPath:'id'});r.result.createObjectStore('folders',{keyPath:'id'});tracks.put({id:'original',title:'Original',note:'kept',blob,lastPosition:3,folderId:'folder',playCount:0,priority:false,addedAt:1});};
  r.onsuccess=()=>{r.result.close();resolve();};
 });
 library=await openLibrary(dbName);
 const track=await library.get('tracks','original');const audio=await library.get('audio','original');
 assert(track.note==='kept'&&track.lastPosition===3&&!('blob' in track),'metadata migration');
 assert(await audio.blob.text()===await blob.text(),'audio migration');
});
await check('Metadata patches preserve Blob and merge independent updates',async()=>{
 await Promise.all([library.patchTrack('original',{title:'Renamed'}),library.patchTrack('original',{note:'New note'}),library.patchTrack('original',{lastPosition:19})]);
 const t=await library.get('tracks','original');assert(t.title==='Renamed'&&t.note==='New note'&&t.lastPosition===19,'patch merge');
 assert(await (await library.get('audio','original')).blob.text()===await blob.text(),'blob unchanged');
});
await check('Folder deletion unassigns audio atomically',async()=>{
 await library.put('folders',{id:'folder',name:'Folder'});await library.removeFolder('folder');
 assert(!(await library.get('folders','folder')),'folder deleted');assert((await library.get('tracks','original')).folderId===null,'unassigned');
 assert(!!(await library.get('audio','original')),'audio remains');
});
await check('Close/reopen retains notes, positions and audio',async()=>{
 library.db.close();library=await openLibrary(dbName);
 assert((await library.get('tracks','original')).lastPosition===19,'position retained');
 assert((await library.get('tracks','original')).note==='New note','notes retained');
 assert(await (await library.get('audio','original')).blob.text()===await blob.text(),'audio retained');
});
await check('Export/import restores full library with exact audio bytes',async()=>{
 const before=await library.snapshot();const restored=await readBackup(await createBackup(before));
 await library.restore(restored);
 assert((await library.all('tracks')).length===2,'additive restore');
 assert(await checksum((await library.get('audio',restored.tracks[0].id)).blob)===await checksum(blob),'audio equality');
});
await check('Failed restore rolls back all writes, including folders',async()=>{
 let rejected=false;
 try{await library.restore({folders:[{id:'rollback-folder',name:'Should not exist'}],tracks:[{id:'original',title:'Conflict'}],audio:[]});}catch{rejected=true;}
 assert(rejected,'conflict rejected');assert(!(await library.get('folders','rollback-folder')),'transaction rollback');
 assert((await library.get('tracks','original')).title==='Renamed','existing retained');
});
await check('Delete removes audio and late autosave cannot resurrect record',async()=>{
 await library.removeTrack('original');await library.patchTrack('original',{lastPosition:55});
 assert(!(await library.get('tracks','original')),'track absent');assert(!(await library.get('audio','original')),'blob absent');
});
library?.db.close();indexedDB.deleteDatabase(dbName);
output.textContent+='\n\n'+results.filter(r=>r.startsWith('PASS')).length+'/'+results.length+' passed';
