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
 assert(!(await library.get('folders','folder')),'folder deleted');assert((await library.get('tracks','original')).folderIds.length===0,'unassigned');
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

await check('v2→v3 migration preserves single folder, historical counts, names, notes and audio',async()=>{
 const name=dbName+'-v2';
 await new Promise((resolve,reject)=>{const r=indexedDB.open(name,2);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{for(const store of ['tracks','audio','folders','settings'])r.result.createObjectStore(store,{keyPath:'id'});r.transaction.objectStore('tracks').put({id:'legacy',title:'Legacy',note:'private test note',folderId:'f',playCount:18,priority:true,lastPosition:17,addedAt:123});r.transaction.objectStore('audio').put({id:'legacy',blob});r.transaction.objectStore('folders').put({id:'f',name:'Existing'});};r.onsuccess=()=>{r.result.close();resolve();};});
 const old=await openLibrary(name),track=await old.get('tracks','legacy');
 assert(track.folderIds[0]==='f'&&track.playCount===18&&track.priority&&!track.pinned&&track.lastPosition===17&&track.addedAt===123&&track.note==='private test note','metadata preserved');
 assert((await old.all('audio')).length===1&&await (await old.get('audio','legacy')).blob.text()===await blob.text(),'one unchanged audio Blob');old.db.close();indexedDB.deleteDatabase(name);
});
await check('A/B: atomic batch of 15 keeps old assignments; clear all folders keeps recordings',async()=>{
 for(const id of ['old','a','b'])await library.put('folders',{id,name:id});
 for(let i=0;i<15;i++)await library.addTrack({id:'batch-'+i,title:'Safe '+i,folderIds:i%2?['old']:[],note:'kept',addedAt:i,playCount:0},blob);
 const ids=Array.from({length:15},(_,i)=>'batch-'+i);await library.assignFolders(ids,{a:true,b:true});
 let rows=(await library.all('tracks')).filter(t=>ids.includes(t.id));assert(rows.length===15&&rows.every(t=>t.folderIds.includes('a')&&t.folderIds.includes('b')),'all assigned');assert(rows.find(t=>t.id==='batch-1').folderIds.includes('old'),'old kept');
 const audioCount=(await library.all('audio')).length;await library.assignFolders(['batch-1'],{old:false,a:false,b:false});assert((await library.get('tracks','batch-1')).folderIds.length===0,'all unchecked');await library.removeFolder('a');assert((await library.all('audio')).length===audioCount,'no audio deleted or duplicated');assert((await library.get('tracks','batch-2')).folderIds.includes('b'),'other folder retained');
});
await check('I: coverage and count commit atomically once, survive reopen; stale pass cannot overwrite restart',async()=>{
 let row=await library.get('tracks','batch-1');const pass=row.listen.id;
 await library.recordProgress(row.id,pass,[[0,89]],100,89);assert((await library.get('tracks',row.id)).playCount===0,'89 percent');
 await Promise.all([library.recordProgress(row.id,pass,[[0,90]],100,90),library.recordProgress(row.id,pass,[[0,100]],100,0,true)]);
 library.db.close();library=await openLibrary(dbName);row=await library.get('tracks',row.id);assert(row.playCount===1&&row.listen.counted,'one credit after restart');
 await library.patchTrack(row.id,{listen:{id:'new-pass',ranges:[],counted:false,ended:false}});await library.recordProgress(row.id,pass,[[0,100]],100,100);row=await library.get('tracks',row.id);assert(row.listen.id==='new-pass'&&row.playCount===1,'late save ignored');
});
await check('L: new format roundtrip retains folders, pin/priority, coverage and exact Blobs',async()=>{
 await library.patchTrack('batch-2',{pinned:true,priority:true,listen:{id:'partial',ranges:[[0,30]],counted:false,ended:false},phrases:{status:'not-connected',items:[]}});
 const restored=await readBackup(await createBackup(await library.snapshot()));const row=restored.tracks.find(t=>t.title==='Safe 2');assert(row.pinned&&row.priority&&row.folderIds.length===1&&row.listen.ranges[0][1]===30,'new fields');assert(await checksum(restored.audio.find(a=>a.id===row.id).blob)===await checksum(blob),'exact bytes');
});
await check('L: file-backed archive survives IndexedDB persistence with correct nonzero audio offset',async()=>{
 const archive=new File([await createBackup(await library.snapshot())],'synthetic-test.efp',{type:'application/octet-stream'});
 const restored=await readBackup(archive);await library.restore(restored);library.db.close();library=await openLibrary(dbName);
 for(const row of restored.audio)assert(await checksum((await library.get('audio',row.id)).blob)===await checksum(row.blob),'persisted audio bytes');
});
await check('v3 to v4 adds learning without modifying audio, note, folders or listening history',async()=>{
 const name=dbName+'-v3';await new Promise((resolve,reject)=>{const r=indexedDB.open(name,3);r.onerror=()=>reject(r.error);r.onupgradeneeded=()=>{for(const store of ['tracks','audio','folders','settings'])r.result.createObjectStore(store,{keyPath:'id'});r.transaction.objectStore('tracks').put({id:'old',title:'V3',folderIds:['f'],note:'Keep note',playCount:9,priority:true,pinned:true,listen:{id:'pass',ranges:[[0,3]],counted:false,ended:false}});r.transaction.objectStore('audio').put({id:'old',blob});};r.onsuccess=()=>{r.result.close();resolve();};});
 const v4=await openLibrary(name),row=await v4.get('tracks','old');assert(row.note==='Keep note'&&row.playCount===9&&row.folderIds[0]==='f'&&row.listen.id==='pass','old metadata');assert(await (await v4.get('audio','old')).blob.text()===await blob.text(),'original audio');assert((await v4.all('learning')).length===0,'empty additive store');v4.db.close();indexedDB.deleteDatabase(name);
});
await check('Transcript persists independently, exports/restores and cannot resurrect deleted audio',async()=>{
 const transcript={format:'english-flow-transcript',version:1,audio:{sha256:'a'.repeat(64),size:blob.size,duration:3},segments:[{id:'s',start:0,end:3,en:'Please check in.',ru:'Test translation'}]};
 await library.putLearning('batch-1',{transcript,phrases:[]});library.db.close();library=await openLibrary(dbName);assert((await library.get('learning','batch-1')).transcript.segments[0].en==='Please check in.','reopen');
 const restored=await readBackup(await createBackup(await library.snapshot()));assert(restored.learning.length===1,'backup contains learning');await library.restore(restored);assert(!!(await library.get('learning',restored.learning[0].id)),'restored link');
 await library.removeTrack('batch-1');assert(!await library.putLearning('batch-1',{transcript,phrases:[]}),'late save rejected');assert(!await library.get('learning','batch-1'),'learning deleted with audio');
});
library?.db.close();indexedDB.deleteDatabase(dbName);
output.textContent+='\n\n'+results.filter(r=>r.startsWith('PASS')).length+'/'+results.length+' passed';
