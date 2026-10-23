import {id,folderIds,SORT_MODES} from './core.js';
import {newPass,mergeRanges} from './listening.js';
const MAGIC = 'EFPB0001';
const MAX_MANIFEST = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const crcTable = Array.from({length:256}, (_, n) => {
  for (let i=0; i<8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export async function checksum(blob) {
  let crc = 0xffffffff;
  // Bounded memory even for long recordings; no base64 copies.
  for (let offset=0; offset<blob.size; offset+=1024*1024) {
    const bytes = new Uint8Array(await blob.slice(offset,offset+1024*1024).arrayBuffer());
    for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8,'0');
}
export async function createBackup(snapshot, progress = () => {}) {
  const blobs = new Map(snapshot.audio.map(row => [row.id, row.blob]));
  const records = [];
  const parts = [];
  for (const [index, track] of snapshot.tracks.entries()) {
    const blob = blobs.get(track.id);
    if (!(blob instanceof Blob)) throw new Error('audioMissing');
    records.push({...track, size:blob.size, type:blob.type, checksum:await checksum(blob)});
    parts.push(blob);
    progress(index+1,snapshot.tracks.length);
  }
  const json = encoder.encode(JSON.stringify({format:'english-flow-backup',version:2,settings:snapshot.settings||[],createdAt:new Date().toISOString(),folders:snapshot.folders,tracks:records}));
  if (json.length > MAX_MANIFEST) throw new Error('backupTooLarge');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0,json.length,true);
  return new Blob([MAGIC,length,json,...parts], {type:'application/octet-stream'});
}
const invalid = () => { throw new Error('backupInvalid'); };
const text = (value,max) => typeof value === 'string' && value.length <= max;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
export async function readBackup(file, progress = () => {}) {
  if (file.size < 12) invalid();
  const header = new Uint8Array(await file.slice(0,12).arrayBuffer());
  if (decoder.decode(header.slice(0,8)) !== MAGIC) invalid();
  const size = new DataView(header.buffer).getUint32(8,true);
  if (!size || size > MAX_MANIFEST || size + 12 > file.size) invalid();
  let manifest;
  try { manifest = JSON.parse(decoder.decode(await file.slice(12,12+size).arrayBuffer())); } catch { invalid(); }
  if (manifest?.format !== 'english-flow-backup' || ![1,2].includes(manifest.version) || !Array.isArray(manifest.tracks) || !Array.isArray(manifest.folders) || manifest.tracks.length > 10000 || manifest.folders.length > 10000) invalid();
  const folderIds = new Map();
  const folders = manifest.folders.map(f => {
    if (!f || !text(f.id,200) || !f.id || folderIds.has(f.id) || !text(f.name,1000) || !f.name.trim()) invalid();
    const newId = id(); folderIds.set(f.id,newId);
    return {id:newId, name:f.name, createdAt:number(f.createdAt) ? f.createdAt : Date.now()};
  });
  const trackIds = new Map();
  const tracks = [], audio = [];
  let offset = 12+size;
  for (const [index,t] of manifest.tracks.entries()) {
    if (!t || !text(t.id,200) || !t.id || trackIds.has(t.id) || !text(t.title,1000) || !t.title.trim() || !text(t.note || '',1000000) || !text(t.type || '',100) || !Number.isSafeInteger(t.size) || t.size <= 0 || offset+t.size > file.size || !/^[a-f0-9]{8}$/.test(t.checksum) || (t.folderId != null && !folderIds.has(t.folderId))) invalid();
    const memberships=Array.isArray(t.folderIds)?t.folderIds:t.folderId?[t.folderId]:[];
    if(memberships.length>10000||memberships.some(value=>!folderIds.has(value))||(t.folderIds!=null&&!Array.isArray(t.folderIds)))invalid();
    let listen=newPass();
    if(t.listen!=null){
      const l=t.listen;
      if(!text(l.id,200)||!l.id||!Array.isArray(l.ranges)||l.ranges.length>20000||l.ranges.some(r=>!Array.isArray(r)||r.length!==2||!r.every(number)||r[1]<r[0]))invalid();
      listen={id:id(),ranges:mergeRanges(l.ranges),counted:l.counted===true,ended:l.ended===true};
    }
    let phrases={status:'not-connected',items:[]};
    if(t.phrases!=null){
      if(!Array.isArray(t.phrases.items)||t.phrases.items.length>15)invalid();
      phrases={status:t.phrases.status==='ready'?'ready':'not-connected',items:t.phrases.items.map(item=>{
        if(!item||!text(item.expression,1000)||!text(item.meaning,5000)||!text(item.context,10000)||(item.time!=null&&!number(item.time)))invalid();
        return {id:id(),expression:item.expression,meaning:item.meaning,context:item.context,time:item.time??null,known:item.known===true};
      })};
    }
    // Safari can lose a non-zero File.slice offset when that Blob is persisted in
    // IndexedDB. Materialize bounded chunks before storage; never persist a File view.
    const chunks=[];
    for(let start=offset;start<offset+t.size;start+=1024*1024){
      chunks.push(new Blob([await file.slice(start,Math.min(start+1024*1024,offset+t.size)).arrayBuffer()]));
    }
    const blob=new Blob(chunks,{type:t.type||'application/octet-stream'});
    if (await checksum(blob) !== t.checksum) invalid();
    const newId = id();trackIds.set(t.id,newId);
    tracks.push({id:newId,title:t.title,note:t.note || '',type:t.type || '',size:t.size,folderIds:[...new Set(memberships.map(value=>folderIds.get(value)))],pinned:t.pinned===true,listen,phrases,priority:t.priority === true,duration:number(t.duration)?t.duration:0,playCount:Number.isSafeInteger(t.playCount)&&t.playCount>=0?t.playCount:0,lastPosition:number(t.lastPosition)?t.lastPosition:0,addedAt:number(t.addedAt)?t.addedAt:Date.now()});
    audio.push({id:newId,blob});
    offset+=t.size;
    progress(index+1,manifest.tracks.length);
  }
  if (offset !== file.size) invalid();
  const settings=[];
  if(Array.isArray(manifest.settings))for(const setting of manifest.settings){
    if(!setting||typeof setting.id!=='string')invalid();
    const {value}=setting;
    if(setting.id==='language'&&['ru','en'].includes(value)||setting.id==='sort'&&SORT_MODES.includes(value)||setting.id==='speed'&&[0.75,1,1.25,1.5,1.75,2].includes(value))settings.push({id:setting.id,value});
    if(setting.id==='lastTrack'&&trackIds.has(value))settings.push({id:'lastTrack',value:trackIds.get(value)});
    if(setting.id==='listOptions'&&value&&[0,1,2,3].includes(value.total))settings.push({id:'listOptions',value:{shuffle:value.shuffle===true,total:value.total}});
    if(setting.id==='queue'&&value){
      const q={...value};
      for(const key of ['source','remaining','manual','visited','history','failed']){
        if(!Array.isArray(q[key])||q[key].length>100000||q[key].some(id=>!trackIds.has(id)))invalid();
        q[key]=q[key].map(id=>trackIds.get(id));
      }
      if(!Number.isInteger(q.cursor)||q.cursor<0||q.cursor>=q.history.length||!Number.isInteger(q.pass)||q.pass<1||![0,1,2,3].includes(q.total))invalid();
      q.shuffle=q.shuffle===true;q.ended=q.ended===true;
      q.context=typeof q.context==='string'&&q.context.startsWith('folder:')?'folder:'+folderIds.get(q.context.slice(7)):['all','review','mastered','priority'].includes(q.context)?q.context:'restored';
      settings.push({id:'queue',value:q});
    }
  }
  return {tracks,folders,audio,settings};
}
