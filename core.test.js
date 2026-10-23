import test from 'node:test';
import assert from 'node:assert/strict';
import {audioType,nextId,resumePosition,visibleTracks,formatTime} from './core.js';
import {createBackup,readBackup,checksum} from './backup.js';
const blob=new Blob([new Uint8Array([1,2,3,4,5])],{type:'audio/wav'});
const fixture={folders:[{id:'folder',name:'Lessons',createdAt:1}],tracks:[{id:'track',title:'Lesson',note:'a < b & c',size:5,type:'audio/wav',duration:23,playCount:7,priority:true,lastPosition:12,folderId:'folder',addedAt:2}],audio:[{id:'track',blob}]};
test('Files with missing MIME types accept known audio extensions',()=>{
 assert.equal(audioType({name:'VOICE.M4A',type:''}),'audio/mp4');
 assert.equal(audioType({name:'lesson.mp3',type:'application/octet-stream'}),'audio/mpeg');
 assert.equal(audioType({name:'file.exe',type:''}),'');
});
test('Queue advances across folders, stops without repeat, and wraps only when requested',()=>{
 const queue=[{id:'a'},{id:'b'},{id:'c'}];
 assert.equal(nextId(queue,'b',1),'c');assert.equal(nextId(queue,'c',1),null);
 assert.equal(nextId(queue,'c',1,true),'a');assert.equal(nextId(queue,'a',-1,true),'c');
 assert.equal(nextId([],null,1,true),null);assert.equal(nextId([{id:'a'}],'a',1,true),'a');
});
test('Completed files restart; short saved positions and zero remain valid',()=>{
 assert.equal(resumePosition(1.5,60),1.5);assert.equal(resumePosition(60,60),0);
 assert.equal(resumePosition(0,60),0);assert.equal(resumePosition(Infinity,60),0);
 assert.equal(formatTime(3661),'61:01');
});
test('Default library order is newest first; learned filter remains available',()=>{
 const rows=[{id:'a',priority:false,playCount:10,addedAt:1},{id:'b',priority:true,playCount:2,addedAt:2}];
 assert.deepEqual(visibleTracks(rows,'all').map(t=>t.id),['b','a']);
 assert.deepEqual(visibleTracks(rows,'mastered').map(t=>t.id),['a']);
});
test('CRC-32 matches standard vector',async()=>assert.equal(await checksum(new Blob(['123456789'])),'cbf43926'));
test('Backup roundtrip preserves audio bytes and metadata; identifiers remapped',async()=>{
 const file=await createBackup(fixture);const result=await readBackup(file);
 assert.equal(result.tracks[0].title,'Lesson');assert.equal(result.tracks[0].note,'a < b & c');
 assert.equal(result.tracks[0].lastPosition,12);assert.equal(result.tracks[0].folderIds[0],result.folders[0].id);
 assert.notEqual(result.tracks[0].id,'track');assert.notEqual(result.folders[0].id,'folder');
 assert.deepEqual(new Uint8Array(await result.audio[0].blob.arrayBuffer()),new Uint8Array(await blob.arrayBuffer()));
 const second=await readBackup(file);assert.notEqual(second.tracks[0].id,result.tracks[0].id);
});
test('Truncated, corrupted, unknown-version and trailing-data backups rejected',async()=>{
 const file=await createBackup(fixture);
 await assert.rejects(readBackup(file.slice(0,file.size-1)));
 const bytes=new Uint8Array(await file.arrayBuffer());bytes[bytes.length-1]^=1;
 await assert.rejects(readBackup(new Blob([bytes])));
 bytes[0]=0;await assert.rejects(readBackup(new Blob([bytes])));
 await assert.rejects(readBackup(new Blob([file,'extra'])));
});
test('Invalid metadata, duplicate IDs and orphan folders rejected before write',async()=>{
 for(const mutate of [f=>{f.tracks[0].title='';},f=>{f.tracks.push({...f.tracks[0]});},f=>{f.tracks[0].folderId='missing';}]){
  const f={...fixture,folders:fixture.folders.map(t=>({...t})),tracks:fixture.tracks.map(t=>({...t}))};mutate(f);
  await assert.rejects(readBackup(await createBackup(f)));
 }
});
test('Multi-chunk backup and empty library roundtrip',async()=>{
 const large=new Blob([new Uint8Array(2*1024*1024+1).fill(37)],{type:'audio/mpeg'});
 const result=await readBackup(await createBackup({...fixture,audio:[{id:'track',blob:large}]}));
 assert.equal(result.audio[0].blob.size,large.size);assert.equal(await checksum(result.audio[0].blob),await checksum(large));
 assert.equal((await readBackup(await createBackup({tracks:[],folders:[],audio:[]}))).tracks.length,0);
});
