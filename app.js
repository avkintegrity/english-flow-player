import {openLibrary} from './db.js';
import {audioType, id, formatTime, formatBytes, visibleTracks, nextId, resumePosition, errorMessage} from './core.js';
import {createBackup, readBackup} from './backup.js';

const $ = selector => document.querySelector(selector);
const audio = $('#audio');
let library, tracks = [], folders = [], blobs = new Map();
let currentTrackId = null, currentFilter = 'all', folderViewId = null;
let loopMode = 'none', queue = [], currentUrl = null, selectedFolderIds = new Set();
let assignTrackId = null, editTrackId = null, noteTargetId = null;
let pendingNote = null, noteTimer, lastPositionSave = 0, busy = false, pendingWorker, preparedBackup, updateRequested = false;
let countedThisLoad = false;
let resumeAt = 0, playbackToken = 0, progressWrite = Promise.resolve(), noticeTimer;
const trackById = id => tracks.find(t => t.id === id);
const folderById = id => folders.find(f => f.id === id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guarded = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(reportError);
function notify(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error',error);
  clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>{ $('#status').textContent=''; },error?14000:6500);
}
function reportError(error) { console.error(error); notify(errorMessage(error),true); }
function show(selector) { $(selector).classList.remove('hidden'); }
function hide(selector) { $(selector).classList.add('hidden'); }
function getVisibleTracks() {
  const list = visibleTracks(tracks,currentFilter);
  return folderViewId ? list.filter(t => t.folderId === folderViewId) : list;
}
function renderTracks() {
  const filtered = getVisibleTracks();
  $('#empty-state').classList.toggle('hidden',filtered.length > 0);
  $('#empty-title').textContent = tracks.length ? 'Здесь пока нет записей' : 'Пока нет аудио';
  $('#folder-view-heading').classList.toggle('hidden',!folderViewId);
  $('#folder-view-name').textContent = folderById(folderViewId)?.name || '';
  $('#tracks-list').innerHTML = filtered.map(t => `
    <article class="track-card ${t.id === currentTrackId ? 'playing' : ''}" data-id="${escapeHtml(t.id)}">
      <div class="track-top">
        <button class="track-play-btn" data-action="play" aria-label="${t.id === currentTrackId && !audio.paused ? 'Пауза' : 'Слушать'}: ${escapeHtml(t.title)}">${t.id === currentTrackId && !audio.paused ? '⏸' : '▶'}</button>
        <button class="track-info" data-action="open" aria-label="Открыть: ${escapeHtml(t.title)}">
          <span class="track-title">${escapeHtml(t.title)}</span>
          <span class="track-meta"><span>${formatTime(t.duration)}</span><span class="play-count">×${t.playCount || 0}</span>${t.folderId ? `<span class="folder-badge">${escapeHtml(folderById(t.folderId)?.name || '')}</span>` : ''}</span>
        </button>
        <button class="btn-icon" data-action="edit" aria-label="Изменить: ${escapeHtml(t.title)}">⋯</button>
      </div>${t.note ? `<div class="track-note-preview">${escapeHtml(t.note)}</div>` : ''}
    </article>`).join('');
}
function renderFolders() {
  $('#btn-play-selected').classList.toggle('hidden',!selectedFolderIds.size);
  $('#folders-list').innerHTML = folders.length ? folders.map(f => `
    <div class="folder-card ${selectedFolderIds.has(f.id) ? 'selected' : ''}" data-id="${escapeHtml(f.id)}">
      <button class="folder-checkbox-button" data-action="select" aria-label="Выбрать: ${escapeHtml(f.name)}" aria-pressed="${selectedFolderIds.has(f.id)}">${selectedFolderIds.has(f.id) ? '☑' : '☐'}</button>
      <button class="folder-info" data-action="open"><span class="folder-name">${escapeHtml(f.name)}</span><span>${tracks.filter(t=>t.folderId===f.id).length} аудио</span></button>
      <div class="folder-actions"><button data-action="play" aria-label="Слушать папку: ${escapeHtml(f.name)}">▶</button><button data-action="delete" aria-label="Удалить папку: ${escapeHtml(f.name)}">🗑</button></div>
    </div>`).join('') : '<div class="empty-state"><p>Папок пока нет</p><p class="empty-hint">Создайте первую папку</p></div>';
}
function renderPlayer() {
  const t = trackById(currentTrackId);
  $('#player-bar').classList.toggle('hidden',!t);
  if (!t) return;
  $('#mini-title').textContent = $('#full-title').textContent = t.title;
  $('#mini-meta').textContent = `${formatTime(audio.currentTime)} / ${formatTime(t.duration)}`;
  $('#full-meta').textContent = `Прослушано ${t.playCount || 0} раз • ${formatTime(t.duration)}`;
  $('#btn-play').textContent = $('#btn-mini-play').textContent = audio.paused ? '▶' : '⏸';
  $('#btn-play').setAttribute('aria-label',audio.paused ? 'Воспроизвести' : 'Пауза');
  $('#btn-mini-play').setAttribute('aria-label',audio.paused ? 'Воспроизвести' : 'Пауза');
  $('#btn-priority').classList.toggle('active',!!t.priority);
  $('#priority-icon').textContent = t.priority ? '★' : '☆';
  renderTracks();
}
async function patchTrack(trackId, patch) {
  const result = await library.patchTrack(trackId,patch);
  const index = tracks.findIndex(t=>t.id===trackId);
  if (result && index !== -1) tracks[index] = result;
  return result;
}
function savePosition(position = audio.currentTime) {
  const target = currentTrackId;
  if (!library || !target || !Number.isFinite(position)) return Promise.resolve();
  const pending = patchTrack(target,{lastPosition:position});
  progressWrite = pending.catch(reportError);
  return pending;
}
function flushNote() {
  clearTimeout(noteTimer);
  if (!pendingNote) return Promise.resolve();
  const draft = pendingNote; pendingNote = null;
  return patchTrack(draft.id,{note:draft.text}).then(() => {
    if (draft.id === noteTargetId && !pendingNote) $('#note-status').textContent = 'Сохранено на устройстве';
    renderTracks();
  }).catch(error => {
    if (!pendingNote) pendingNote = draft;
    $('#note-status').textContent = 'Не сохранено — повторите';
    throw error;
  });
}
function openNote() {
  if (noteTargetId !== currentTrackId) {
    flushNote().catch(reportError);
    noteTargetId = currentTrackId;
    $('#note-input').value = trackById(currentTrackId)?.note || '';
  }
  show('#note-area');
  $('#note-input').focus();
}
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const t = trackById(currentTrackId);
  if (!t) { navigator.mediaSession.metadata = null; return; }
  if ('MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({title:t.title,artist:'English Flow',album:folderById(t.folderId)?.name || 'Моя библиотека',artwork:[{src:new URL('./icon-512.png',location.href).href,sizes:'512x512',type:'image/png'}]});
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  updateMediaPosition();
}
function updateMediaPosition() {
  if (!navigator.mediaSession?.setPositionState || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  try { navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.max(0,Math.min(audio.currentTime,audio.duration))}); } catch {}
}
function attachTrack(trackId) {
  const t = trackById(trackId), blob = blobs.get(trackId);
  if (!t || !blob) throw new Error('Аудиофайл не найден. Восстановите запись из резервной копии.');
  playbackToken++;
  // Save before switching IDs; late pause events must not overwrite the old position with zero.
  savePosition(audio.ended?0:audio.currentTime).catch(reportError);
  flushNote().catch(reportError);
  audio.pause();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentTrackId = trackId;
  countedThisLoad = false;
  currentUrl = URL.createObjectURL(blob);
  resumeAt = resumePosition(t.lastPosition,t.duration);
  audio.src = currentUrl;
  audio.playbackRate = Number($('#speed-select').value);
  audio.load();
  noteTargetId = trackId;
  $('#note-input').value = t.note || '';
  $('#note-status').textContent = '';
  hide('#note-area');
  library.put('settings',{id:'lastTrack',value:trackId}).catch(reportError);
  renderPlayer(); updateMediaSession();
}
function startAudio() {
  // Called synchronously from the tap; all Blob handles are loaded before controls are enabled.
  const token = playbackToken;
  return audio.play().catch(error => {
    if (token !== playbackToken || error.name === 'AbortError') return;
    renderPlayer();
    if (error.name === 'NotAllowedError') notify('Нажмите ▶ ещё раз, чтобы разрешить воспроизведение.',true);
    else notify('Этот файл не воспроизводится устройством. Попробуйте MP3, M4A или WAV.',true);
  });
}
function playTrack(trackId, newQueue, force = false) {
  if (newQueue) queue = [...newQueue];
  if (currentTrackId === trackId && !force) { togglePlay(); return; }
  attachTrack(trackId);
  startAudio();
}
function togglePlay() {
  if (!currentTrackId) return;
  if (audio.paused) { if (audio.ended) audio.currentTime = 0; startAudio(); }
  else { savePosition().catch(reportError); audio.pause(); }
}
function seek(delta) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0,Math.min(audio.duration,audio.currentTime+delta));
  savePosition().catch(reportError); updateMediaPosition();
}
function advance(delta, wrap = true) {
  const rows = queue.map(trackById).filter(Boolean);
  const next = nextId(rows,currentTrackId,delta,wrap);
  if (next) playTrack(next,undefined,true);
}
function setLoopMode(mode) {
  loopMode = mode; audio.loop = mode === 'one';
  $('#loop-label').textContent = {none:'Выкл',one:'Один трек',folder:'Очередь'}[mode];
  $('#btn-loop').classList.toggle('active',mode !== 'none');
}
function playFolders(ids) {
  const items = tracks.filter(t=>ids.has(t.folderId));
  if (!items.length) { notify('В выбранных папках пока нет аудио.'); return; }
  setLoopMode('folder');
  playTrack(items[0].id,items.map(t=>t.id),true); show('#full-player');
}
function setFilter(filter) {
  currentFilter = filter; folderViewId = null;
  document.querySelectorAll('.filter-btn').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===filter));
  $('#tracks-view').classList.toggle('active',filter!=='folders');
  $('#folders-view').classList.toggle('active',filter==='folders');
  renderTracks(); renderFolders();
}
function openEdit(trackId) {
  editTrackId = trackId;
  $('#track-name-input').value = trackById(trackId).title;
  $('#edit-title').textContent = 'Изменить запись';
  show('#modal-edit-track');
}
function openAssign(trackId) {
  assignTrackId = trackId;
  $('#modal-folder-title').textContent = `«${trackById(trackId).title}» → папка`;
  $('#modal-folder-list').innerHTML = [{id:'',name:'Без папки'},...folders].map(f=>`<button class="modal-item" data-folder-id="${escapeHtml(f.id)}">${escapeHtml(f.name)}</button>`).join('');
  show('#modal-folder');
}
async function refreshLibrary() {
  const snapshot = await library.snapshot();
  tracks = snapshot.tracks; folders = snapshot.folders;
  blobs = new Map(snapshot.audio.map(row=>[row.id,row.blob]));
  renderTracks(); renderFolders();
}
async function storageStatus() {
  const estimate = await navigator.storage?.estimate?.().catch(()=>null);
  const persisted = await navigator.storage?.persisted?.().catch(()=>false);
  $('#storage-status').textContent = `${tracks.length} записей • ${formatBytes(tracks.reduce((n,t)=>n+(t.size || 0),0))}${estimate?.quota ? ` • доступно примерно ${formatBytes(Math.max(0,estimate.quota-estimate.usage))}` : ''}. ${persisted ? 'Устойчивое хранение разрешено.' : 'Браузер не гарантирует постоянное хранение.'}`;
}
async function checkSpace(bytes) {
  const estimate = await navigator.storage?.estimate?.().catch(()=>null);
  if (estimate?.quota && bytes > estimate.quota-estimate.usage) throw new DOMException('Недостаточно места','QuotaExceededError');
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('[data-library-action]').forEach(button=>button.disabled=value);
}
async function handleFiles(files) {
  if (busy) return;
  setBusy(true);
  let imported=0, skipped=0;
  try {
    await navigator.storage?.persist?.().catch(()=>false);
    for (const file of files) {
      const type=audioType(file);
      if (!type || !file.size) { skipped++; continue; }
      await checkSpace(file.size);
      const blob = file.slice(0,file.size,type);
      const track = {id:id(), title:file.name.replace(/\.[^/.]+$/,'').slice(0,200) || 'Аудио', type, size:file.size, duration:0,playCount:0,priority:false,note:'',lastPosition:0,folderId:folderViewId,addedAt:Date.now()};
      await library.addTrack(track,blob);
      tracks.push(track); blobs.set(track.id,blob); imported++;
      notify(`Сохранено ${imported} из ${files.length}…`);
    }
    notify(`Добавлено: ${imported}.${skipped ? ` Пропущено пустых или неподдерживаемых файлов: ${skipped}.` : ' Аудио сохранено только на этом устройстве.'}`);
  } catch (error) { notify(`Добавлено: ${imported}. ${errorMessage(error)}`,true); }
  finally { setBusy(false); renderTracks(); renderFolders(); storageStatus().catch(reportError); }
}
function downloadBackup() {
  if (!preparedBackup) return;
  const url=URL.createObjectURL(preparedBackup.file);
  const link=document.createElement('a'); link.href=url; link.download=preparedBackup.file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  notify('Сохраните файл .efp в «Файлы». Он содержит все аудио и заметки.');
}
async function prepareBackup() {
  if (busy) return;
  setBusy(true); hide('#backup-ready'); preparedBackup=null;
  try {
    await flushNote(); await savePosition(); await progressWrite;
    const blob = await createBackup(await library.snapshot(),(n,total)=>notify(`Подготовка копии: ${n} / ${total}`));
    const file = new File([blob],`english-flow-${new Date().toLocaleDateString('sv-SE')}.efp`,{type:'application/octet-stream'});
    preparedBackup={file};
    $('#backup-size').textContent = `Копия готова • ${formatBytes(file.size)}`;
    $('#btn-share-backup').classList.toggle('hidden',!navigator.canShare?.({files:[file]}));
    show('#backup-ready'); notify('Резервная копия готова. Нажмите «Сохранить файл» или «Поделиться».');
  } finally { setBusy(false); }
}
async function importBackup(file) {
  if (busy) return;
  setBusy(true);
  try {
    notify('Проверка резервной копии…');
    const snapshot=await readBackup(file,(n,total)=>notify(`Проверка аудио: ${n} / ${total}`));
    await checkSpace(snapshot.audio.reduce((n,row)=>n+row.blob.size,0));
    if (!confirm(`Добавить ${snapshot.tracks.length} записей и ${snapshot.folders.length} папок? Существующие данные сохранятся. Повторный импорт создаст отдельные копии.`)) return;
    await library.restore(snapshot); await refreshLibrary(); await storageStatus();
    notify(`Восстановлено записей: ${snapshot.tracks.length}.`);
  } finally { setBusy(false); }
}

// Keep a single HTML audio element for system controls, Bluetooth and background playback.
audio.addEventListener('play',()=>{
  if(currentTrackId && !countedThisLoad){countedThisLoad=true;patchTrack(currentTrackId,{playCount:(trackById(currentTrackId)?.playCount || 0)+1}).then(renderPlayer).catch(reportError);}
});
for (const event of ['play','pause']) audio.addEventListener(event,()=>{renderPlayer();updateMediaSession();});
audio.addEventListener('loadedmetadata',()=>{
  if (!currentTrackId) return;
  if (Number.isFinite(audio.duration)) {
    audio.currentTime = Math.min(resumePosition(resumeAt,audio.duration),audio.duration);
    resumeAt=0;
    patchTrack(currentTrackId,{duration:audio.duration}).then(renderPlayer).catch(reportError);
  }
  audio.playbackRate=Number($('#speed-select').value);
  updateMediaPosition();
});
audio.addEventListener('timeupdate',()=>{
  if (!Number.isFinite(audio.duration)) return;
  $('#seek-bar').value=audio.currentTime/audio.duration*100;
  $('#current-time').textContent=formatTime(audio.currentTime);
  $('#duration').textContent=formatTime(audio.duration);
  $('#mini-meta').textContent=`${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  if (Date.now()-lastPositionSave>3000 && !audio.paused) {lastPositionSave=Date.now();savePosition().catch(reportError);}
  updateMediaPosition();
});
audio.addEventListener('seeked',()=>savePosition().catch(reportError));
audio.addEventListener('ended',()=>{
  savePosition(0).catch(reportError);
  advance(1,loopMode==='folder');
  renderPlayer();
});
audio.addEventListener('error',()=>{if(currentTrackId) notify('Формат или кодек не поддерживается устройством, либо файл повреждён. Запись сохранена; попробуйте другой аудиофайл.',true);});

$('#btn-add').onclick=()=>$('#file-input').click();
$('#file-input').onchange=e=>{const files=[...e.target.files];e.target.value='';handleFiles(files).catch(reportError);};
document.querySelectorAll('.filter-btn').forEach(button=>button.onclick=()=>setFilter(button.dataset.filter));
$('#btn-back-folders').onclick=()=>setFilter('folders');
$('#tracks-list').onclick=e=>{
  const action=e.target.closest('[data-action]')?.dataset.action;
  const trackId=e.target.closest('[data-id]')?.dataset.id;
  if (!trackId || !action) return;
  if (action==='edit') openEdit(trackId);
  else if (action==='open') {
    if(currentTrackId!==trackId) attachTrack(trackId);
    queue=getVisibleTracks().map(t=>t.id); show('#full-player');
  } else if(action==='play') playTrack(trackId,getVisibleTracks().map(t=>t.id));
};
$('#folders-list').onclick=guarded(async e=>{
  const action=e.target.closest('[data-action]')?.dataset.action;
  const folderId=e.target.closest('[data-id]')?.dataset.id;
  if (!folderId) return;
  if(action==='select') {if(selectedFolderIds.has(folderId))selectedFolderIds.delete(folderId);else selectedFolderIds.add(folderId);renderFolders();}
  if(action==='open') {setFilter('all');folderViewId=folderId;renderTracks();}
  if(action==='play') playFolders(new Set([folderId]));
  if(action==='delete' && confirm('Удалить папку? Аудио останутся в разделе «Все».')) {
    await library.removeFolder(folderId);selectedFolderIds.delete(folderId);await refreshLibrary();
  }
});
$('#btn-create-folder').onclick=()=>{$('#folder-name-input').value='';show('#modal-create-folder');$('#folder-name-input').focus();};
$('#btn-folder-save').onclick=guarded(async()=>{
  const name=$('#folder-name-input').value.trim();if(!name)return;
  const folder={id:id(),name,createdAt:Date.now()};await library.put('folders',folder);folders.push(folder);hide('#modal-create-folder');renderFolders();
});
$('#btn-play-selected').onclick=()=>playFolders(selectedFolderIds);
$('#btn-folder-cancel').onclick=()=>hide('#modal-create-folder');
$('#btn-modal-close').onclick=()=>hide('#modal-folder');
$('#modal-folder-list').onclick=guarded(async e=>{
  const button=e.target.closest('[data-folder-id]');if(!button)return;
  await patchTrack(assignTrackId,{folderId:button.dataset.folderId || null});hide('#modal-folder');renderTracks();renderFolders();updateMediaSession();
});
$('#btn-edit-close').onclick=()=>hide('#modal-edit-track');
$('#btn-rename').onclick=guarded(async()=>{
  const title=$('#track-name-input').value.trim();if(!title)return;
  await patchTrack(editTrackId,{title});hide('#modal-edit-track');renderTracks();renderPlayer();updateMediaSession();notify('Название сохранено.');
});
$('#btn-edit-folder').onclick=()=>{hide('#modal-edit-track');openAssign(editTrackId);};
$('#btn-delete-track').onclick=guarded(async()=>{
  const target=editTrackId;
  if(!confirm(`Удалить «${trackById(target).title}» с этого устройства? Восстановить можно из резервной копии.`))return;
  await library.removeTrack(target);
  if(pendingNote?.id===target)pendingNote=null;
  if(currentTrackId===target){playbackToken++;currentTrackId=null;audio.pause();audio.removeAttribute('src');audio.load();if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null;hide('#full-player');updateMediaSession();}
  tracks=tracks.filter(t=>t.id!==target);blobs.delete(target);queue=queue.filter(v=>v!==target);
  hide('#modal-edit-track');renderTracks();renderFolders();renderPlayer();notify('Запись удалена.');
});
$('#btn-player-edit').onclick=()=>openEdit(currentTrackId);
$('#player-mini').onclick=e=>{if(!e.target.closest('#btn-mini-play'))show('#full-player');};
$('#btn-mini-play').onclick=togglePlay;
$('#btn-close-player').onclick=()=>{flushNote().catch(reportError);hide('#full-player');};
$('#btn-play').onclick=togglePlay;
$('#btn-rewind').onclick=()=>seek(-15);$('#btn-forward').onclick=()=>seek(15);
$('#btn-prev').onclick=()=>advance(-1);$('#btn-next').onclick=()=>advance(1);
$('#seek-bar').oninput=e=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(e.target.value)/100*audio.duration;};
$('#speed-select').onchange=()=>{audio.playbackRate=Number($('#speed-select').value);library.put('settings',{id:'speed',value:audio.playbackRate}).catch(reportError);updateMediaPosition();};
$('#btn-loop').onclick=()=>setLoopMode(['none','one','folder'][(['none','one','folder'].indexOf(loopMode)+1)%3]);
$('#btn-priority').onclick=guarded(async()=>{await patchTrack(currentTrackId,{priority:!trackById(currentTrackId).priority});renderPlayer();});
$('#btn-note').onclick=openNote;
$('#note-input').oninput=e=>{pendingNote={id:noteTargetId,text:e.target.value};$('#note-status').textContent='Сохранение…';clearTimeout(noteTimer);noteTimer=setTimeout(()=>flushNote().catch(reportError),500);};
$('#btn-save-note').onclick=guarded(async()=>{await flushNote();$('#note-status').textContent='Сохранено на устройстве';});
$('#btn-settings').onclick=()=>{show('#modal-settings');storageStatus().catch(reportError);};
$('#btn-settings-close').onclick=()=>hide('#modal-settings');
$('#btn-persist').onclick=guarded(async()=>{await navigator.storage?.persist?.();await storageStatus();});
$('#btn-export').onclick=guarded(prepareBackup);
$('#btn-download-backup').onclick=downloadBackup;
$('#btn-share-backup').onclick=()=>navigator.share({files:[preparedBackup.file],title:'English Flow — резервная копия'}).catch(error=>{if(error.name!=='AbortError')reportError(error);});
$('#btn-import-backup').onclick=()=>$('#backup-input').click();
$('#backup-input').onchange=guarded(async e=>{const file=e.target.files[0];e.target.value='';if(file)await importBackup(file);});
$('#btn-update').onclick=guarded(async()=>{
  if (busy) {notify('Дождитесь завершения импорта или экспорта.');return;}
  await flushNote();await savePosition();audio.pause();
  if (!pendingWorker || pendingWorker.state === 'redundant' || pendingWorker.state === 'activated') { location.reload(); return; }
  updateRequested = true;
  pendingWorker.postMessage({type:'SKIP_WAITING'});
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){savePosition().catch(reportError);flushNote().catch(reportError);}});
window.addEventListener('pagehide',()=>{savePosition().catch(reportError);flushNote().catch(reportError);});
window.addEventListener('online',()=>notify('Сеть доступна. Аудио по-прежнему хранится только на устройстве.'));
window.addEventListener('offline',()=>notify('Без интернета. Сохранённые записи доступны.'));
if('mediaSession' in navigator){
  for(const [action,handler] of Object.entries({play:()=>startAudio(),pause:()=>{savePosition().catch(reportError);audio.pause();},seekbackward:e=>seek(-(e.seekOffset||15)),seekforward:e=>seek(e.seekOffset||15),seekto:e=>{if(Number.isFinite(e.seekTime)){audio.currentTime=e.seekTime;savePosition().catch(reportError);}},previoustrack:()=>advance(-1),nexttrack:()=>advance(1)})){
    try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
  }
}
try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}

async function initServiceWorker(){
  if(!('serviceWorker' in navigator)){ $('#offline-status').textContent='Офлайн-режим недоступен в этом браузере.';return;}
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    const announceUpdate=()=>{if(registration.waiting){pendingWorker=registration.waiting;if(navigator.serviceWorker.controller)show('#update-banner');}};
    announceUpdate();
    registration.addEventListener('updatefound',()=>{registration.installing?.addEventListener('statechange',announceUpdate);});
    let reloading=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested&&!reloading){reloading=true;location.reload();}});
    await navigator.serviceWorker.ready;
    const scope=registration.scope;
    const cached=await caches.keys();
    const available=await Promise.all(cached.filter(key=>key.startsWith(`english-flow-shell:${new URL(scope).pathname}:`)).map(async key=>{
      const cache=await caches.open(key);return !!(await cache.match(new URL('index.html',scope).href));
    }));
    $('#offline-status').textContent=available.some(Boolean)?'Приложение готово к работе без интернета.':'Офлайн-кэш ещё не готов. Оставьте приложение открытым с интернетом.';
  }catch(error){$('#offline-status').textContent='Не удалось подготовить офлайн-режим. Подключитесь к интернету и откройте приложение снова.';console.error(error);}
}
async function init(){
  setBusy(true);
  try{
    library=await openLibrary();await refreshLibrary();
    const speed=(await library.get('settings','speed'))?.value;
    if([0.75,1,1.25,1.5,1.75,2].includes(speed))$('#speed-select').value=String(speed);
    const last=(await library.get('settings','lastTrack'))?.value;
    if(trackById(last)){attachTrack(last);queue=getVisibleTracks().map(t=>t.id);}
    setBusy(false);notify(tracks.length?'Библиотека загружена с устройства.':'Добавьте аудио кнопкой +.');
    storageStatus().catch(reportError);
  }catch(error){reportError(error);$('#status').textContent+=' Хранилище не открыто; добавление файлов отключено.';}
  initServiceWorker();
}
init();
