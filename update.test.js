import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {visibleTracks,normalizeTrack,folderStates,applyFolderChanges} from './core.js';
import {PlaybackQueue,shuffleIds} from './queue.js';
import {newPass,consumePlayed} from './listening.js';
import {createBackup,readBackup,checksum} from './backup.js';
import {messages,t,setLanguage} from './i18n.js';
import {gestureDirection,isEdge} from './gestures.js';
const random=()=>0.37;
test('A/B: 15 records gain two folders without losing existing links or duplicating audio IDs',()=>{
 const rows=Array.from({length:15},(_,i)=>normalizeTrack({id:String(i),folderId:i%2?'old':null}));
 const changed=rows.map(t=>({...t,folderIds:applyFolderChanges(t,{a:true,b:true})}));
 assert.equal(new Set(changed.map(t=>t.id)).size,15);
 assert.deepEqual(changed[1].folderIds,['old','a','b']);
 assert.deepEqual(folderStates(changed,[{id:'old'},{id:'a'},{id:'none'}]).map(x=>x.state),['some','all','none']);
 assert.deepEqual(applyFolderChanges(changed[1],{old:false,a:false,b:false}),[]);
});
test('C/J: priority never changes sort rank; pinning is independent; all six modes and ties',()=>{
 const rows=[{id:'a',addedAt:1,size:30,playCount:2,priority:true},{id:'b',addedAt:2,size:10,playCount:5},{id:'c',addedAt:3,size:20,playCount:1}];
 const expected={newest:'cba',oldest:'abc',largest:'acb',smallest:'bca',least:'cab',most:'bac'};
 for(const [mode,order] of Object.entries(expected))assert.equal(visibleTracks(rows,'all',mode).map(t=>t.id).join(''),order);
 assert.equal(visibleTracks(rows,'priority').map(t=>t.id).join(''),'a');
 assert.equal(visibleTracks(rows.map(t=>({...t,pinned:t.id==='a'})),'all','newest').map(t=>t.id).join(''),'acb');
 assert.deepEqual(visibleTracks([{id:'b'},{id:'a'}]).map(t=>t.id),['a','b']);
});
test('I: 89% = 0, 90% = 1, end and persisted resume cannot count twice',()=>{
 let pass=newPass(),r=consumePlayed(pass,[],100);assert.equal(r.credit,false);
 r=consumePlayed(r.pass,[[0,89]],100);assert.equal(r.credit,false);
 r=consumePlayed(r.pass,[[0,90]],100);assert.equal(r.credit,true);
 r=consumePlayed(JSON.parse(JSON.stringify(r.pass)),[[0,100]],100);assert.equal(r.credit,false);
 assert.equal(consumePlayed(newPass(),[[0,100]],100).credit,true);
});
test('I: seek gaps, repeated fragments and waiting never create coverage; 2× uses content seconds',()=>{
 let r=consumePlayed(newPass(),[[95,100]],100);assert.equal(r.credit,false);assert.equal(r.covered,5);
 for(let n=0;n<10;n++)r=consumePlayed(r.pass,[[0,8]],100);
 assert.equal(r.covered,13);assert.equal(r.credit,false);
 assert.equal(consumePlayed(newPass(),[[0,45],[45,90]],100).credit,true);
 assert.equal(consumePlayed(newPass(),[[0,30],[50,100]],100).credit,false);
 assert.equal(consumePlayed(newPass(),[[0,100]],NaN).credit,false);
});
function walk(q,max=100){const out=[q.current];while(out.length<max){const next=q.next();if(!next)break;out.push(next);}return out;}
test('K: list repeats 1/2/3 and infinite; empty and single-record lists',()=>{
 for(const total of [1,2,3]){const q=new PlaybackQueue(null,random);q.start(['a','b','c'],{total});assert.equal(walk(q).join(''),'abc'.repeat(total));assert.equal(q.state.ended,true);}
 const forever=new PlaybackQueue(null,random);forever.start(['a'],{total:0});assert.equal(walk(forever,10).join(''),'a'.repeat(10));assert.equal(forever.state.ended,false);
 assert.equal(new PlaybackQueue().start([]),null);
});
test('K: starting fourth continues to end, then subsequent full passes; persisted pause retains pass',()=>{
 const q=new PlaybackQueue(null,random);q.start(['a','b','c','d','e'],{startId:'d',total:2});assert.equal(q.next(),'e');
 const restored=new PlaybackQueue(JSON.parse(JSON.stringify(q.state)),random);assert.equal(walk(restored).join(''),'eabcde');assert.equal(restored.state.pass,2);
});
test('K: deterministic Fisher–Yates is unique per pass and avoids boundary repeats',()=>{
 assert.equal(new Set(shuffleIds(['a','b','c','a'],random)).size,3);
 const q=new PlaybackQueue(null,random);q.start(['a','b','c'],{shuffle:true,total:3});const order=walk(q);
 for(let i=0;i<9;i+=3)assert.equal(new Set(order.slice(i,i+3)).size,3);
 assert.notEqual(order[2],order[3]);assert.notEqual(order[5],order[6]);
});
test('K: shuffle toggles affect only remaining IDs, retain repeat count; previous follows actual history',()=>{
 const q=new PlaybackQueue(null,random);q.start(['a','b','c','d'],{total:3});assert.equal(q.next(),'b');q.setShuffle(true);assert.equal(q.state.total,3);assert.ok(!q.state.remaining.includes('a'));assert.ok(!q.state.remaining.includes('b'));
 q.setShuffle(false);assert.deepEqual(q.state.remaining,['c','d']);assert.equal(q.next(),'c');assert.equal(q.previous(),'b');assert.equal(q.next(),'c');assert.equal(q.next(),'d');
});
test('K: play next moves upcoming ID without duplicate; explicit replay of played ID is separate',()=>{
 const q=new PlaybackQueue(null,random);q.start(['a','b','c']);q.playNext('c');q.playNext('c');assert.equal(walk(q).join(''),'acb');
 q.start(['a','b','c']);q.next();q.playNext('a');q.setShuffle(true);assert.equal(walk(q).join(''),'bac');
});
test('K: deletion and unsupported files cannot cause infinite retry, even with infinite repeat',()=>{
 const q=new PlaybackQueue(null,random);q.start(['a','b','c'],{total:0});q.prune(['a','c']);q.fail('a');assert.equal(q.next(),'c');q.fail('c');assert.equal(q.next(),null);assert.equal(q.state.ended,true);
});
test('K: sorting and counters cannot mutate a queue snapshot',()=>{
 const rows=[{id:'a',addedAt:1},{id:'b',addedAt:2}],q=new PlaybackQueue();q.start(visibleTracks(rows).map(t=>t.id));rows[0].playCount=99;rows.reverse();assert.deepEqual(q.state.source,['b','a']);
});
const blob=new Blob(['safe synthetic bytes'],{type:'audio/wav'});
const legacyTrack={id:'t',title:'Personal title',note:'Личная заметка',folderId:'f',addedAt:10,size:blob.size,type:blob.type,playCount:18,priority:true,lastPosition:7,duration:100};
async function legacyBackup(){const json=new TextEncoder().encode(JSON.stringify({format:'english-flow-backup',version:1,folders:[{id:'f',name:'Personal folder'}],tracks:[{...legacyTrack,checksum:await checksum(blob)}]}));const length=new Uint8Array(4);new DataView(length.buffer).setUint32(0,json.length,true);return new Blob(['EFPB0001',length,json,blob]);}
test('L: version 1 .efp preserves historical count, original folder, note, position and exact audio',async()=>{
 const result=await readBackup(await legacyBackup()),track=result.tracks[0];assert.equal(track.playCount,18);assert.equal(track.note,legacyTrack.note);assert.equal(track.lastPosition,7);assert.equal(track.priority,true);assert.equal(track.pinned,false);assert.deepEqual(track.folderIds,[result.folders[0].id]);assert.equal(await result.audio[0].blob.text(),await blob.text());
});
test('L: new backup preserves multiple folders, pin/priority, listening coverage, phrases and remapped queue',async()=>{
 const track={...normalizeTrack(legacyTrack),pinned:true,folderIds:['f','g'],listen:{...newPass(),ranges:[[0,60]],counted:false},phrases:{status:'ready',items:[{id:'phrase',expression:'follow through',meaning:'довести до конца',context:'We need to follow through.',time:3,known:true}]}};
 const q=new PlaybackQueue();q.start(['t'],{total:3});
 const snapshot={tracks:[track],folders:[{id:'f',name:'One'},{id:'g',name:'Two'}],audio:[{id:'t',blob}],settings:[{id:'language',value:'en'},{id:'sort',value:'largest'},{id:'queue',value:q.state},{id:'lastTrack',value:'t'}]};
 const restored=await readBackup(await createBackup(snapshot)),r=restored.tracks[0];assert.equal(r.folderIds.length,2);assert.equal(r.pinned,true);assert.equal(r.priority,true);assert.deepEqual(r.listen.ranges,[[0,60]]);assert.equal(r.phrases.items[0].known,true);assert.equal(restored.settings.find(x=>x.id==='queue').value.source[0],r.id);assert.equal(restored.settings.find(x=>x.id==='lastTrack').value,r.id);assert.equal(r.note,track.note);
});
test('D: vertical motion, small jitter and edge gesture remain distinct from horizontal swipe',()=>{
 assert.equal(gestureDirection(8,50),'vertical');assert.equal(gestureDirection(6,3),null);assert.equal(gestureDirection(80,10),'right');assert.equal(gestureDirection(-80,10),'left');assert.equal(isEdge(10,390),true);assert.equal(isEdge(380,390),true);assert.equal(isEdge(190,390),false);
});
test('H: every static and literal dynamic translation key exists in both languages',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const keys=[...html.matchAll(/data-i18n(?:-aria|-title|-placeholder)?="([^"]+)"/g)].map(m=>m[1]);keys.push(...[...app.matchAll(/\b(?:t|notify)\('([A-Za-z]+)'/g)].map(m=>m[1]));
 for(const key of keys){assert.ok(messages[key],key);assert.equal(messages[key].length,2);assert.ok(messages[key].every(Boolean),key);}
 setLanguage('en');assert.equal(t('selected',{n:15}),'Selected: 15');setLanguage('ru');assert.equal(t('selected',{n:15}),'Выбрано: 15');
});

test('K: explicit next wins after Previous without duplicating forward history; Previous reopens ended queue',()=>{
 const q=new PlaybackQueue();q.start(['a','b','c','d']);q.next();q.next();assert.equal(q.previous(),'b');q.playNext('d');assert.equal(walk(q).join(''),'bdc');assert.equal(q.state.ended,true);assert.equal(q.previous(),'d');assert.equal(q.state.ended,false);
});
