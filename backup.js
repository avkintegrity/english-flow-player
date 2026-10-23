import {id} from './core.js';
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
    if (!(blob instanceof Blob)) throw new Error(`Не найдено аудио: ${track.title}`);
    records.push({...track, size:blob.size, type:blob.type, checksum:await checksum(blob)});
    parts.push(blob);
    progress(index+1,snapshot.tracks.length);
  }
  const json = encoder.encode(JSON.stringify({format:'english-flow-backup',version:1,createdAt:new Date().toISOString(),folders:snapshot.folders,tracks:records}));
  if (json.length > MAX_MANIFEST) throw new Error('Слишком много метаданных для одной резервной копии.');
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0,json.length,true);
  return new Blob([MAGIC,length,json,...parts], {type:'application/octet-stream'});
}
const invalid = () => { throw new Error('Повреждённая или неподдерживаемая резервная копия. Ничего не изменено.'); };
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
  if (manifest?.format !== 'english-flow-backup' || manifest.version !== 1 || !Array.isArray(manifest.tracks) || !Array.isArray(manifest.folders) || manifest.tracks.length > 10000 || manifest.folders.length > 10000) invalid();
  const folderIds = new Map();
  const folders = manifest.folders.map(f => {
    if (!f || !text(f.id,200) || !f.id || folderIds.has(f.id) || !text(f.name,1000) || !f.name.trim()) invalid();
    const newId = id(); folderIds.set(f.id,newId);
    return {id:newId, name:f.name, createdAt:number(f.createdAt) ? f.createdAt : Date.now()};
  });
  const trackIds = new Set();
  const tracks = [], audio = [];
  let offset = 12+size;
  for (const [index,t] of manifest.tracks.entries()) {
    if (!t || !text(t.id,200) || !t.id || trackIds.has(t.id) || !text(t.title,1000) || !t.title.trim() || !text(t.note || '',1000000) || !text(t.type || '',100) || !Number.isSafeInteger(t.size) || t.size <= 0 || offset+t.size > file.size || !/^[a-f0-9]{8}$/.test(t.checksum) || (t.folderId != null && !folderIds.has(t.folderId))) invalid();
    trackIds.add(t.id);
    const blob = file.slice(offset,offset+t.size,t.type || 'application/octet-stream');
    if (await checksum(blob) !== t.checksum) invalid();
    const newId = id();
    tracks.push({id:newId,title:t.title,note:t.note || '',type:t.type || '',size:t.size,folderId:folderIds.get(t.folderId) || null,priority:t.priority === true,duration:number(t.duration)?t.duration:0,playCount:Number.isSafeInteger(t.playCount)&&t.playCount>=0?t.playCount:0,lastPosition:number(t.lastPosition)?t.lastPosition:0,addedAt:number(t.addedAt)?t.addedAt:Date.now()});
    audio.push({id:newId,blob});
    offset+=t.size;
    progress(index+1,manifest.tracks.length);
  }
  if (offset !== file.size) invalid();
  return {tracks,folders,audio};
}
