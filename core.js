// Shared, side-effect-free rules used by the UI and backup reader.
export const AUDIO_TYPES = {mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', wav:'audio/wav', wave:'audio/wav', aac:'audio/aac', aif:'audio/aiff', aiff:'audio/aiff', caf:'audio/x-caf', flac:'audio/flac', ogg:'audio/ogg', oga:'audio/ogg', opus:'audio/ogg', webm:'audio/webm'};
export const id = () => crypto.randomUUID();
export const audioType = file => file.type?.startsWith('audio/') ? file.type : AUDIO_TYPES[file.name.split('.').pop().toLowerCase()] || '';
export const formatTime = seconds => {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const formatBytes = bytes => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} ГБ` : `${(bytes / 1024 ** 2).toFixed(1)} МБ`;
export const SORT_MODES=['newest','oldest','largest','smallest','least','most'];
export function folderIds(track) { return [...new Set(Array.isArray(track.folderIds)?track.folderIds:track.folderId?[track.folderId]:[])]; }
export function normalizeTrack(track) {
  const {folderId,...rest}=track;
  return {...rest,folderIds:folderIds(track),pinned:track.pinned===true,priority:track.priority===true};
}
export function visibleTracks(tracks, filter='all', sort='newest') {
  const mode=SORT_MODES.includes(sort)?sort:'newest';
  const value=t=>mode==='largest'||mode==='smallest'?(t.size||0):mode==='least'||mode==='most'?(t.playCount||0):(t.addedAt||0);
  const direction=['newest','largest','most'].includes(mode)?-1:1;
  return tracks.filter(t=>filter==='priority'?t.priority:filter==='review'?(t.playCount||0)<5:filter==='mastered'?(t.playCount||0)>=5:true)
    .sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||direction*(value(a)-value(b))||(a.addedAt||0)-(b.addedAt||0)||a.id.localeCompare(b.id));
}
export function folderStates(rows, folders) {
  return folders.map(f=>{const n=rows.filter(t=>folderIds(t).includes(f.id)).length;return {id:f.id,state:n===0?'none':n===rows.length?'all':'some'};});
}
export function applyFolderChanges(track, changes) {
  const ids=new Set(folderIds(track));
  for(const [id,checked] of Object.entries(changes))if(checked)ids.add(id);else ids.delete(id);
  return [...ids];
}
export function nextId(queue, currentId, delta, wrap = false) {
  if (!queue.length) return null;
  const index = queue.findIndex(t => t.id === currentId);
  const next = index + delta;
  return wrap ? queue[(next + queue.length) % queue.length]?.id || null : queue[next]?.id || null;
}
export function resumePosition(position, duration) {
  if (!Number.isFinite(position) || position < 0) return 0;
  return Number.isFinite(duration) && duration > 0 && position >= duration - 0.25 ? 0 : position;
}
export function errorMessage(error) {
  if (error?.name === 'QuotaExceededError') return 'Недостаточно места. Сохраните резервную копию, освободите место и повторите. Уже сохранённые записи не удалены.';
  return error?.message || 'Операция не завершена. Попробуйте ещё раз.';
}
