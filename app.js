import {InlineSubtitles} from './inline-subtitles.js';
import {Phrasebook} from './phrasebook.js';
import {LearningPlayer} from './learning-player.js';
import {openLibrary} from './db.js';
import {audioType,id,formatTime,visibleTracks,folderIds,folderStates,SORT_MODES} from './core.js';
import {createBackup,readBackup} from './backup.js';
import {newPass,nativeRanges} from './listening.js';
import {PlaybackQueue} from './queue.js';
import {t,messages,getLanguage,setLanguage,translateDOM,bytesLabel} from './i18n.js';

export const VERSION='2.2.0';
const $=selector=>document.querySelector(selector),audio=$('#audio');
let library,tracks=[],folders=[],blobs=new Map(),currentTrackId=null,currentFilter='all',folderViewId=null,sortMode='newest',visibleOrder=[];
let queue=new PlaybackQueue(),listOptions={shuffle:false,total:1},repeatOne=false,currentUrl=null,playbackToken=0,resumeAt=0,mediaReady=false,activePass=null;
let selectionMode=false,selectedIds=new Set(),selectedFolderIds=new Set(),editTrackId=null,assignIds=[],assignChanges={},assignInitial=[],phrasesTrackId=null,showKnown=false;
let pendingNote=null,noteTargetId=null,noteTimer,noteWrite=Promise.resolve(),noteRevision=0,noteStatus='',progressWrite=Promise.resolve(),lastProgress=0;
let busy=false,pendingWorker,updateRequested=false,preparedBackup,offlineStatus='offlinePreparing',notice=null,noticeTimer,swipeId=null,suppressClickUntil=0;
let dragSeek=null,lastStorage=null,lastPersisted=false,failedPlaybackToken=-1,playIntent=false;
const panels=[],focusReturns=new Map();
let learning,phrasebook;
const inlineSubtitles=new InlineSubtitles();
const byId=target=>tracks.find(track=>track.id===target),folderById=target=>folders.find(folder=>folder.id===target);
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const guarded=fn=>(...args)=>Promise.resolve().then(()=>fn(...args)).catch(reportError);
const show=selector=>$(selector).classList.remove('hidden'),hide=selector=>$(selector).classList.add('hidden');
const noteOpen=()=>!$('#note-area').classList.contains('hidden');
function notify(key,vars={},error=false){notice={key,vars,error};paintNotice();clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{notice=null;paintNotice();},error?14000:6500);}
function paintNotice(){$('#status').textContent=notice?t(notice.key,notice.vars):'';$('#status').classList.toggle('error',!!notice?.error);}
function reportError(error){console.error(error);notify(error?.name==='QuotaExceededError'?'quota':messages[error?.message]?error.message:'operationFailed',{},true);}
function replaceRows(rows){for(const row of rows||[]){const index=tracks.findIndex(t=>t.id===row.id);if(index!==-1)tracks[index]=row;}}
async function patchTrack(target,patch){const row=await library.patchTrack(target,patch);if(row)replaceRows([row]);return row;}
function setting(key,value){return library?.put('settings',{id:key,value});}
function context(){return folderViewId?'folder:'+folderViewId:currentFilter;}
function currentRows(reset=false){
  let rows=visibleTracks(tracks,currentFilter,sortMode);
  if(folderViewId)rows=rows.filter(t=>folderIds(t).includes(folderViewId));
  const ids=rows.map(t=>t.id),allowed=new Set(ids);
  visibleOrder=reset?ids:[...visibleOrder.filter(id=>allowed.has(id)),...ids.filter(id=>!visibleOrder.includes(id))];
  return visibleOrder.map(byId).filter(Boolean);
}
function actionButton(action,label,extra=''){return `<button data-action="${action}" class="${extra}">${html(label)}</button>`;}
function renderTracks(reset=false){
  const rows=currentRows(reset);
  $('#empty-state').classList.toggle('hidden',!!rows.length);$('#empty-title').textContent=t(tracks.length?'emptyHere':'empty');
  $('#folder-view-heading').classList.toggle('hidden',!folderViewId);$('#folder-view-name').textContent=folderById(folderViewId)?.name||'';
  $('#tracks-list').classList.toggle('selecting',selectionMode);
  $('#tracks-list').innerHTML=rows.map(track=>{
    const selected=selectedIds.has(track.id),isCurrent=track.id===currentTrackId,playing=isCurrent&&!audio.paused;
    return `<article class="track-card ${isCurrent?'playing':''} ${selected?'selected':''} ${swipeId?.id===track.id?'swipe-'+swipeId.direction:''}" data-id="${html(track.id)}" aria-label="${html(track.title+(selectionMode?' — '+t(selected?'selectedTrack':'unselectedTrack'):''))}">
      <div class="swipe-actions left">${actionButton('pin',t(track.pinned?'unpin':'pin'))}${actionButton('priority',t(track.priority?'removePriority':'addPriority'))}${actionButton('next',t('playNext'))}</div>
      <div class="swipe-actions right">${actionButton('folders',t('folders'))}${actionButton('rename',t('rename'))}${actionButton('delete',t('delete'),'danger')}</div>
      <div class="track-face"><div class="track-top"><span class="selection-check" aria-hidden="true">${selected?'☑':'☐'}</span>
      <button class="track-play-btn" data-action="play" aria-label="${html(t(playing?'pause':'play')+': '+track.title)}">${playing?'⏸':'▶'}</button>
      <button class="track-info" data-action="open" ${selectionMode?`aria-pressed="${selected}"`:''} aria-label="${html(t(selectionMode?(selected?'selectedTrack':'unselectedTrack'):'open')+': '+track.title)}"><span class="track-title"><span class="track-flags">${track.pinned?'📌 ':''}${track.priority?'★ ':''}</span>${html(track.title)}</span><span class="track-meta"><span>${formatTime(track.duration)}</span><span class="play-count">×${track.playCount||0}</span><span>${bytesLabel(track.size||0)}</span>${folderIds(track).map(fid=>`<span class="folder-badge">${html(folderById(fid)?.name||'')}</span>`).join('')}</span></button>
      <button class="btn-icon" data-action="edit" aria-label="${html(t('edit')+': '+track.title)}">⋯</button></div><div class="inline-subtitle hidden"><p></p><button class="btn-secondary" data-action="text">${html(t('createText'))}</button></div>${track.note?`<div class="track-note-preview">${html(t('note'))}: ${html(track.note)}</div>`:''}</div></article>`;
  }).join('');renderSelection();paintPlayback();
}
function renderSelection(){
  $('#selection-header').classList.toggle('hidden',!selectionMode);$('#btn-select').classList.toggle('hidden',selectionMode);
  $('#selection-count').textContent=t('selected',{n:selectedIds.size});
  const all=visibleOrder.length>0&&visibleOrder.every(id=>selectedIds.has(id));$('#btn-select-all').textContent=t(all?'deselectAll':'selectAll');
  $('#batch-actions').classList.toggle('hidden',!selectionMode);$('#batch-actions').querySelectorAll('button').forEach(b=>b.disabled=!selectedIds.size||busy);
  updateInsets();
}
function renderFolders(){
  $('#btn-play-selected').classList.toggle('hidden',!selectedFolderIds.size);
  $('#folders-list').innerHTML=folders.length?folders.map(f=>`<div class="folder-card ${selectedFolderIds.has(f.id)?'selected':''}" data-id="${html(f.id)}"><button class="folder-checkbox-button" data-action="select" aria-label="${html(t('select')+': '+f.name)}" aria-pressed="${selectedFolderIds.has(f.id)}">${selectedFolderIds.has(f.id)?'☑':'☐'}</button><button class="folder-info" data-action="open"><span class="folder-name">${html(f.name)}</span><span>${html(t('audioCount',{n:tracks.filter(t=>folderIds(t).includes(f.id)).length}))}</span></button><div class="folder-actions"><button data-action="play" aria-label="${html(t('play')+': '+f.name)}">▶</button><button data-action="delete" aria-label="${html(t('delete')+': '+f.name)}">🗑</button></div></div>`).join(''):`<div class="empty-state"><p>${t('noFolders')}</p><p>${t('createFirst')}</p></div>`;
}
function renderQueue(){
  $('#btn-list-play').textContent=t(queue.state&&!queue.state.ended&&queue.state.context===context()?'resumeList':'playList');
  $('#btn-shuffle').setAttribute('aria-pressed',String(listOptions.shuffle));$('#list-repeat').value=String(listOptions.total);
  $('#queue-status').textContent=queue.state?(queue.state.ended?t('listDone'):t('pass',{n:queue.state.pass,total:queue.state.total||'∞'})):'';
  $('#repeat-conflict').classList.toggle('hidden',!repeatOne);$('#btn-loop').setAttribute('aria-pressed',String(repeatOne));$('#loop-label').textContent=t(repeatOne?'on':'off');
}
function paintPlayback(){
  const track=byId(currentTrackId);$('#player-bar').classList.toggle('hidden',!track);
  if(track){
    $('#mini-title').textContent=(track.priority?'★ ':'')+track.title;$('#full-title').textContent=track.title;
    $('#full-meta').textContent=t('listens',{n:track.playCount||0,duration:formatTime(track.duration)});
    $('#priority-icon').textContent=track.priority?'★':'☆';$('#btn-priority').classList.toggle('active',!!track.priority);$('#btn-priority').setAttribute('aria-pressed',String(!!track.priority));
  }
  for(const selector of ['#btn-play','#btn-mini-play']){$(selector).textContent=audio.paused?'▶':'⏸';$(selector).setAttribute('aria-label',t(audio.paused?'play':'pause'));}
  // Update counts and icons in place. Never re-sort or replace cards on playback events.
  document.querySelectorAll('.track-card').forEach(card=>{const row=byId(card.dataset.id);if(!row)return;const playing=row.id===currentTrackId&&!audio.paused;card.classList.toggle('playing',row.id===currentTrackId);card.querySelector('.play-count').textContent='×'+(row.playCount||0);const button=card.querySelector('[data-action=play]');button.textContent=playing?'⏸':'▶';button.setAttribute('aria-label',t(playing?'pause':'play')+': '+row.title);});
  renderQueue();updateTimeline();inlineSubtitles.render();updateInsets();
}
function updateTimeline(){
  const duration=Number.isFinite(audio.duration)?audio.duration:byId(currentTrackId)?.duration||0;
  for(const [slider,current,end] of [['#seek-bar','#current-time','#duration'],['#mini-seek','#mini-current','#mini-duration']]){
    const value=dragSeek===slider?Number($(slider).value)/100*duration:audio.currentTime||0;
    if(dragSeek!==slider)$(slider).value=duration?value/duration*100:0;
    $(current).textContent=formatTime(value);$(end).textContent=formatTime(duration);$(slider).setAttribute('aria-valuetext',`${formatTime(value)} / ${formatTime(duration)}`);
  }
}
function updateInsets(){
  for(const [selector,property] of [['#player-bar','--mini-height'],['#batch-actions','--batch-height']])document.documentElement.style.setProperty(property,$(selector).getBoundingClientRect().height+'px');
}
function updateViewport(){
  const v=window.visualViewport;document.documentElement.style.setProperty('--viewport-height',(v?.height||window.innerHeight)+'px');document.documentElement.style.setProperty('--viewport-top',(v?.offsetTop||0)+'px');updateInsets();
}
function showPanel(selector){
  closeSwipe();const panel=$(selector);if(panels.includes(selector))return;
  focusReturns.set(selector,document.activeElement);panels.push(selector);show(selector);syncPanels();
  panel.querySelector('button,input,textarea,select')?.focus({preventScroll:true});
}
function syncPanels(){
  document.querySelectorAll('#app > :not(.modal)').forEach(el=>{if(el.id!=='status')el.inert=!!panels.length;});
  panels.forEach((selector,index)=>{$(selector).style.zIndex=50+index*2;$(selector).inert=index!==panels.length-1;});
  document.body.classList.toggle('panel-open',!!panels.length);
}
function dirtyPanel(selector){
  if(selector==='#modal-transcript-edit')return learning.hasDraft();
  if(selector==='#modal-dictionary')return phrasebook.hasDraft();
  if(selector==='#modal-edit-track')return $('#track-name-input').value!==byId(editTrackId)?.title;
  if(selector==='#modal-create-folder')return !!$('#folder-name-input').value.trim();
  return selector==='#modal-folder'&&Object.keys(assignChanges).length>0;
}
async function closePanel(selector=panels.at(-1),force=false){
  if(!selector||!panels.includes(selector))return false;
  if(!force){
    if(selector==='#full-player'){await flushNote();if(pendingNote)return false;$('#note-input').blur();hide('#note-area');}
    if(dirtyPanel(selector)&&!confirm(t('discard')))return false;
  }
  const index=panels.indexOf(selector);if(index!==panels.length-1&&!force)return false;
  for(const removed of panels.splice(index)){hide(removed);$(removed).inert=false;if(removed==='#modal-transcript-edit')learning.closeEditor();if(removed==='#modal-dictionary')phrasebook.closeEditor();}
  syncPanels();const target=focusReturns.get(selector);(target?.isConnected?target:$('#btn-language')).focus({preventScroll:true});return true;
}
function flushNote(){
  clearTimeout(noteTimer);const draft=pendingNote;
  if(!draft)return noteWrite;
  noteWrite=noteWrite.catch(()=>{}).then(async()=>{
    const row=await patchTrack(draft.id,{note:draft.text});if(!row)throw new Error('saveFailed');
    if(pendingNote?.revision===draft.revision)pendingNote=null;
    noteStatus='saved';$('#note-status').textContent=t(noteStatus);
  }).catch(error=>{noteStatus='saveFailed';$('#note-status').textContent=t(noteStatus);throw error;});
  return noteWrite;
}
function openNote(){
  if(!byId(currentTrackId))return;learning.hide();
  if(!noteOpen()){noteTargetId=currentTrackId;$('#note-input').value=pendingNote?.id===noteTargetId?pendingNote.text:byId(noteTargetId).note||'';noteStatus='';$('#note-status').textContent='';}
  $('#note-context').textContent=t('note')+' — '+(byId(noteTargetId)?.title||'');show('#note-area');$('#note-input').focus();$('#note-area').scrollIntoView({block:'nearest'});
}
async function saveNote(){
  if(!pendingNote&&byId(noteTargetId)?.note!==$('#note-input').value)pendingNote={id:noteTargetId,text:$('#note-input').value,revision:++noteRevision};
  await flushNote();if(pendingNote)await flushNote();
  if(!pendingNote){$('#note-input').blur();hide('#note-area');$('#btn-note').focus({preventScroll:true});renderTracks();}
}
function captureProgress(ended=false){
  if(!library||!currentTrackId||!mediaReady||!activePass)return progressWrite;
  const target=currentTrackId,passId=activePass.id,ranges=nativeRanges(audio),duration=audio.duration,position=ended?0:audio.currentTime;
  const write=library.recordProgress(target,passId,ranges,duration,position,ended).then(row=>{if(row){replaceRows([row]);if(target===currentTrackId&&row.listen?.id===activePass?.id)activePass=row.listen;paintPlayback();}});
  progressWrite=write.catch(reportError);return write;
}
function saveQueue(){renderQueue();return setting('queue',queue.state?structuredClone(queue.state):null);}
function attachTrack(target,{restart=false}={}){
  const track=byId(target),blob=blobs.get(target);if(!track||!blob)throw new Error('audioMissing');
  captureProgress().catch(reportError);flushNote().catch(reportError);mediaReady=false;playIntent=false;playbackToken++;failedPlaybackToken=-1;audio.pause();
  if(currentUrl)URL.revokeObjectURL(currentUrl);currentTrackId=target;
  const begin=restart||track.listen?.ended;
  activePass=begin?newPass():track.listen||newPass();
  if(activePass.id!==track.listen?.id){track.listen=activePass;patchTrack(target,{listen:activePass,lastPosition:0}).catch(reportError);}
  resumeAt=begin?0:track.lastPosition||0;
  // Reset the native played ranges only when loading a source/new independent pass.
  currentUrl=URL.createObjectURL(blob);audio.src=currentUrl;audio.playbackRate=Number($('#speed-select').value);audio.load();
  learning?.load(target).catch(reportError);setting('lastTrack',target)?.catch(reportError);paintPlayback();updateMediaSession();
}
function startAudio(){
  if(!currentTrackId)return;playIntent=true;
  const token=playbackToken;
  return audio.play().catch(error=>{if(token!==playbackToken||error.name==='AbortError')return;if(error.name==='NotAllowedError'){notify('playbackBlocked',{},true);paintPlayback();}else handlePlaybackError(token);});
}
function togglePlay(){
  if(!currentTrackId)return;
  if(audio.paused){if(audio.ended||activePass?.ended)attachTrack(currentTrackId,{restart:true});startAudio();}
  else {captureProgress().catch(reportError);audio.pause();}
}
function playRow(target){
  if(currentTrackId===target&&queue.state&&!queue.state.ended){togglePlay();return;}
  queue.start(currentRows().map(t=>t.id),{...listOptions,startId:target,context:context()});saveQueue()?.catch(reportError);
  if(currentTrackId!==target||activePass?.ended)attachTrack(target);startAudio();
}
function playList(ids=currentRows().map(t=>t.id),key=context()){
  if(!ids.length){notify('emptyList');return;}
  if(queue.state&&!queue.state.ended&&queue.state.context===key&&byId(queue.current)){
    if(audio.ended||activePass?.ended){advance(1);return;}
    if(currentTrackId!==queue.current)attachTrack(queue.current);if(audio.paused)startAudio();return;
  }
  const target=queue.start(ids,{...listOptions,context:key});saveQueue()?.catch(reportError);attachTrack(target,{restart:true});startAudio();
}
function advance(delta=1){
  captureProgress().catch(reportError);queue.prune(tracks.map(t=>t.id));
  const target=delta<0?queue.previous():queue.next();saveQueue()?.catch(reportError);
  if(target){attachTrack(target,{restart:true});startAudio();}else {audio.pause();paintPlayback();}
}
function handlePlaybackError(token=playbackToken){
  if(token!==playbackToken||failedPlaybackToken===token)return;failedPlaybackToken=token;
  if(!playIntent||!queue.state){notify('unsupported',{},true);return;}
  queue.fail(currentTrackId);notify('skippedUnsupported',{},true);
  const target=queue.next();saveQueue()?.catch(reportError);
  if(target){attachTrack(target,{restart:true});startAudio();}else {audio.pause();notify('queueStopped',{},true);paintPlayback();}
}
function seekTo(value,resetDrill=true){if(resetDrill)learning?.cancelMode();if(!mediaReady||!Number.isFinite(audio.duration))return;captureProgress().catch(reportError);audio.currentTime=Math.max(0,Math.min(audio.duration,value));updateTimeline();updateMediaPosition();}
function setFilter(filter,folder=null){
  currentFilter=filter;folderViewId=folder;closeSwipe();
  document.querySelectorAll('.filter-btn').forEach(b=>{b.classList.toggle('active',b.dataset.filter===filter);b.setAttribute('aria-current',b.dataset.filter===filter?'page':'false');});
  $('#tracks-view').classList.toggle('active',filter!=='folders'||!!folder);$('#folders-view').classList.toggle('active',filter==='folders'&&!folder);
  if(filter==='folders'&&!folder)exitSelection();renderTracks(true);renderFolders();renderQueue();
}
function enterSelection(target){selectionMode=true;closeSwipe();if(target)selectedIds.add(target);renderTracks();}
function exitSelection(){selectionMode=false;selectedIds.clear();renderTracks();}
function openEdit(target){editTrackId=target;$('#track-name-input').value=byId(target).title;renderEdit();showPanel('#modal-edit-track');}
function renderEdit(){const track=byId(editTrackId);if(!track)return;$('#btn-edit-pin').textContent=t(track.pinned?'unpin':'pin');$('#btn-edit-priority').textContent=t(track.priority?'removePriority':'addPriority');}
function openAssign(ids){assignIds=[...ids].filter(byId);assignChanges={};assignInitial=folderStates(assignIds.map(byId),folders);renderAssign();showPanel('#modal-folder');}
function renderAssign(){
  const focused=document.activeElement?.dataset.folderId;
  $('#modal-folder-title').textContent=t('assignTitle',{n:assignIds.length});
  $('#modal-folder-list').innerHTML=folders.length?folders.map(f=>{const initial=assignInitial.find(s=>s.id===f.id)?.state||'none',state=f.id in assignChanges?(assignChanges[f.id]?'all':'none'):initial;return `<label><input type="checkbox" data-folder-id="${html(f.id)}" ${state==='all'?'checked':''} aria-checked="${state==='some'?'mixed':String(state==='all')}"><span>${html(f.name)}</span><small>${t(state==='all'?'allAssigned':state==='some'?'someAssigned':'noneAssigned')}</small></label>`;}).join(''):`<p>${t('noFolders')} — ${t('createFirst')}</p>`;
  $('#modal-folder-list').querySelectorAll('input').forEach(input=>{input.indeterminate=input.getAttribute('aria-checked')==='mixed';if(input.dataset.folderId===focused)input.focus({preventScroll:true});});
}
async function toggleProperty(target,property){const track=byId(target);if(!track)return;await patchTrack(target,{[property]:!track[property]});renderTracks(property==='pinned');renderEdit();paintPlayback();}
async function batchPriority(value){replaceRows(await library.updateTracks([...selectedIds],()=>({priority:value})));renderTracks();notify('priorityUpdated');}
function nextRequested(target){if(queue.playNext(target)){saveQueue()?.catch(reportError);notify('queuedNext');}else notify('startFirst');closeSwipe();}
async function deleteTracks(ids){
  const targets=[...new Set(ids)].filter(byId);if(!targets.length||!confirm(t('deleteConfirm',{n:targets.length})))return;
  await library.removeTracks(targets);const removed=new Set(targets);
  if(removed.has(pendingNote?.id))pendingNote=null;
  if(removed.has(currentTrackId)){learning?.load(null).catch(reportError);mediaReady=false;activePass=null;playbackToken++;currentTrackId=null;audio.pause();audio.removeAttribute('src');audio.load();if(currentUrl)URL.revokeObjectURL(currentUrl);currentUrl=null;await closePanel('#full-player',true);updateMediaSession();}
  tracks=tracks.filter(t=>!removed.has(t.id));targets.forEach(id=>{blobs.delete(id);selectedIds.delete(id);});queue.prune(tracks.map(t=>t.id));saveQueue()?.catch(reportError);
  if(removed.has(editTrackId))await closePanel('#modal-edit-track',true);renderTracks(true);renderFolders();paintPlayback();notify('deleted',{n:targets.length});
}
function renderPhrases(){phrasebook?.render();}
async function refreshLibrary(){const snapshot=await library.snapshot();tracks=snapshot.tracks;folders=snapshot.folders;blobs=new Map(snapshot.audio.map(row=>[row.id,row.blob]));renderTracks(true);renderFolders();return snapshot;}
function paintStorage(){
  $('#storage-status').textContent=t('storage',{n:tracks.length,size:bytesLabel(tracks.reduce((n,t)=>n+(t.size||0),0))})+(lastStorage?.quota?t('available',{size:bytesLabel(Math.max(0,lastStorage.quota-(lastStorage.usage||0)))}):'')+'. '+t(lastPersisted?'persisted':'bestEffort');
}
async function storageStatus(){lastStorage=await navigator.storage?.estimate?.().catch(()=>null);lastPersisted=await navigator.storage?.persisted?.().catch(()=>false);paintStorage();}
async function checkSpace(bytes){const estimate=await navigator.storage?.estimate?.().catch(()=>null);if(estimate?.quota&&bytes>estimate.quota-estimate.usage)throw new DOMException('quota','QuotaExceededError');}
function setBusy(value){busy=value;document.querySelectorAll('[data-library-action]').forEach(b=>b.disabled=value);renderSelection();}
async function handleFiles(files){
  if(busy)return;setBusy(true);let imported=0,skipped=0;
  try{await navigator.storage?.persist?.().catch(()=>false);for(const file of files){const type=audioType(file);if(!type||!file.size){skipped++;continue;}await checkSpace(file.size);
    const blob=file.slice(0,file.size,type),track={id:id(),title:file.name.replace(/\.[^/.]+$/,'').slice(0,200)||t('defaultAudio'),type,size:file.size,duration:0,playCount:0,priority:false,pinned:false,note:'',lastPosition:0,folderIds:folderViewId?[folderViewId]:[],addedAt:Date.now(),listen:newPass(),phrases:{status:'not-connected',items:[]}};
    await library.addTrack(track,blob);tracks.push(track);blobs.set(track.id,blob);imported++;notify('importing',{n:imported,total:files.length});
  }notify('imported',{n:imported,skipped});}catch(error){console.error(t('importPartial',{n:imported}));reportError(error);}finally{setBusy(false);renderTracks(true);renderFolders();storageStatus().catch(reportError);}
}
async function prepareBackup(){
  if(busy)return;setBusy(true);hide('#backup-ready');preparedBackup=null;
  try{await flushNote();await captureProgress();await saveQueue();await progressWrite;const blob=await createBackup(await library.snapshot(),(n,total)=>notify('backupProgress',{n,total}));const file=new File([blob],`english-flow-${new Date().toISOString().slice(0,10)}.efp`,{type:'application/octet-stream'});preparedBackup={file};$('#backup-size').textContent=t('backupReady',{size:bytesLabel(file.size)});$('#btn-share-backup').classList.toggle('hidden',!navigator.canShare?.({files:[file]}));show('#backup-ready');notify('backupDownloadHint');}finally{setBusy(false);}
}
function downloadBackup(){if(!preparedBackup)return;const url=URL.createObjectURL(preparedBackup.file),link=document.createElement('a');link.href=url;link.download=preparedBackup.file.name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);notify('backupDownloadHint');}
async function importBackup(file){
  if(busy)return;setBusy(true);
  try{notify('checkingBackup');const snapshot=await readBackup(file,(n,total)=>notify('checkingAudio',{n,total}));await checkSpace(snapshot.audio.reduce((n,row)=>n+row.blob.size,0));if(!confirm(t('restoreConfirm',{n:snapshot.tracks.length,folders:snapshot.folders.length})))return;
    const empty=!tracks.length;await library.restore(snapshot,empty);await refreshLibrary();if(empty)await loadSettings();await storageStatus();notify('restored',{n:snapshot.tracks.length});
  }finally{setBusy(false);}
}
function updateMediaSession(){
  if(!('mediaSession' in navigator))return;const track=byId(currentTrackId);if(!track){navigator.mediaSession.metadata=null;return;}
  if('MediaMetadata' in window)navigator.mediaSession.metadata=new MediaMetadata({title:track.title,artist:'English Flow',album:folderIds(track).map(fid=>folderById(fid)?.name).filter(Boolean).join(', ')||t('library'),artwork:[{src:new URL('./icon-512.png',location.href).href,sizes:'512x512',type:'image/png'}]});
  navigator.mediaSession.playbackState=audio.paused?'paused':'playing';updateMediaPosition();
}
function updateMediaPosition(){if(!navigator.mediaSession?.setPositionState||!Number.isFinite(audio.duration)||audio.duration<=0)return;try{navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.max(0,Math.min(audio.currentTime,audio.duration))});}catch{}}
function localize(){translateDOM();learning?.render();$('#note-context').textContent=t('note')+' — '+(byId(noteTargetId)?.title||'');$('#language-indicator').textContent=getLanguage().toUpperCase();$('#app-version').textContent=t('version',{version:VERSION});$('#offline-status').textContent=t(offlineStatus);$('#note-status').textContent=noteStatus?t(noteStatus):'';$('#sort-select').value=sortMode;renderTracks();renderFolders();renderQueue();renderEdit();renderAssign();renderPhrases();paintStorage();paintNotice();if(preparedBackup)$('#backup-size').textContent=t('backupReady',{size:bytesLabel(preparedBackup.file.size)});updateMediaSession();}

// A single audio element preserves system audio controls and Bluetooth routing.
audio.addEventListener('loadedmetadata',()=>{
  if(!currentTrackId)return;mediaReady=true;
  if(Number.isFinite(audio.duration)){audio.currentTime=Math.min(resumeAt,audio.duration);resumeAt=0;patchTrack(currentTrackId,{duration:audio.duration}).then(paintPlayback).catch(reportError);}
  audio.playbackRate=Number($('#speed-select').value);updateMediaPosition();
});
for(const event of ['play','pause','playing','waiting'])audio.addEventListener(event,()=>{if(event==='pause'||event==='waiting')captureProgress().catch(reportError);paintPlayback();updateMediaSession();});
audio.addEventListener('timeupdate',()=>{updateTimeline();if(Date.now()-lastProgress>2000&&mediaReady){lastProgress=Date.now();captureProgress().catch(reportError);}updateMediaPosition();});
audio.addEventListener('seeked',()=>captureProgress().catch(reportError));
audio.addEventListener('ended',()=>{if(learning?.onEnded())return;captureProgress(true).catch(reportError);if(repeatOne){attachTrack(currentTrackId,{restart:true});startAudio();}else advance(1);});
audio.addEventListener('error',()=>{if(currentTrackId)handlePlaybackError();});

$('#btn-add').onclick=()=>$('#file-input').click();$('#file-input').onchange=e=>{const files=[...e.target.files];e.target.value='';handleFiles(files).catch(reportError);};
$('#btn-language').onclick=guarded(async()=>{setLanguage(getLanguage()==='ru'?'en':'ru');localize();await setting('language',getLanguage());});
document.querySelectorAll('.filter-btn').forEach(button=>button.onclick=()=>setFilter(button.dataset.filter));
$('#btn-back-folders').onclick=()=>setFilter('folders');
$('#sort-select').onchange=guarded(async e=>{sortMode=e.target.value;renderTracks(true);await setting('sort',sortMode);});
$('#btn-select').onclick=()=>enterSelection();$('#btn-selection-close').onclick=exitSelection;
$('#btn-select-all').onclick=()=>{const all=visibleOrder.length>0&&visibleOrder.every(id=>selectedIds.has(id));for(const id of visibleOrder)if(all)selectedIds.delete(id);else selectedIds.add(id);renderTracks();};
$('#btn-batch-folders').onclick=()=>openAssign(selectedIds);$('#btn-batch-priority').onclick=guarded(()=>batchPriority(true));$('#btn-batch-unpriority').onclick=guarded(()=>batchPriority(false));$('#btn-batch-delete').onclick=guarded(()=>deleteTracks(selectedIds));
$('#btn-list-play').onclick=()=>playList();
$('#btn-shuffle').onclick=guarded(async()=>{listOptions.shuffle=!listOptions.shuffle;queue.setShuffle(listOptions.shuffle);renderQueue();await setting('listOptions',listOptions);await saveQueue();});
$('#list-repeat').onchange=guarded(async e=>{listOptions.total=Number(e.target.value);queue.setTotal(listOptions.total);renderQueue();await setting('listOptions',listOptions);await saveQueue();});
$('#tracks-list').onclick=guarded(async e=>{
  if(Date.now()<suppressClickUntil){e.preventDefault();return;}
  const card=e.target.closest('.track-card');if(!card)return;const target=card.dataset.id,action=e.target.closest('[data-action]')?.dataset.action;
  if(selectionMode){if(selectedIds.has(target))selectedIds.delete(target);else selectedIds.add(target);renderTracks();return;}
  if(swipeId&&!e.target.closest('.swipe-actions')){closeSwipe();return;}
  if(action==='edit'||action==='rename'){openEdit(target);if(action==='rename')$('#track-name-input').focus();}
  if(action==='folders')openAssign([target]);
  if(action==='pin'||action==='priority'){await toggleProperty(target,action==='pin'?'pinned':'priority');closeSwipe();}
  if(action==='next')nextRequested(target);
  if(action==='delete')await deleteTracks([target]);
  if(action==='play')playRow(target);
  if(action==='open'||action==='text'){
    if(currentTrackId!==target){attachTrack(target);queue.start(currentRows().map(t=>t.id),{...listOptions,startId:target,context:context()});saveQueue()?.catch(reportError);}
    showPanel('#full-player');await learning.open();
  }
});
$('#folders-list').onclick=guarded(async e=>{
  const action=e.target.closest('[data-action]')?.dataset.action,target=e.target.closest('[data-id]')?.dataset.id;if(!target)return;
  if(action==='select'){if(selectedFolderIds.has(target))selectedFolderIds.delete(target);else selectedFolderIds.add(target);renderFolders();}
  if(action==='open')setFilter('folders',target);
  if(action==='play')playFolders(new Set([target]));
  if(action==='delete'&&confirm(t('deleteFolderConfirm'))){await library.removeFolder(target);selectedFolderIds.delete(target);await refreshLibrary();updateMediaSession();}
});
function playFolders(ids){const rows=visibleTracks(tracks,'all',sortMode).filter(track=>folderIds(track).some(id=>ids.has(id)));playList(rows.map(t=>t.id),'folders:'+([...ids].sort().join(',')));}
$('#btn-play-selected').onclick=()=>playFolders(selectedFolderIds);
$('#btn-create-folder').onclick=()=>{$('#folder-name-input').value='';showPanel('#modal-create-folder');$('#folder-name-input').focus();};
$('#btn-folder-save').onclick=guarded(async()=>{const name=$('#folder-name-input').value.trim();if(!name)return;const folder={id:id(),name,createdAt:Date.now()};await library.put('folders',folder);folders.push(folder);$('#folder-name-input').value='';await closePanel('#modal-create-folder');renderFolders();});
$('#modal-folder-list').onchange=e=>{const input=e.target.closest('[data-folder-id]');if(input){assignChanges[input.dataset.folderId]=input.checked;renderAssign();}};
$('#btn-assign-apply').onclick=guarded(async()=>{replaceRows(await library.assignFolders(assignIds,assignChanges));assignChanges={};await closePanel('#modal-folder');renderTracks();renderFolders();updateMediaSession();notify('foldersApplied');});
$('#btn-rename').onclick=guarded(async()=>{const title=$('#track-name-input').value.trim();if(!title)return;await patchTrack(editTrackId,{title});$('#track-name-input').value=title;await closePanel('#modal-edit-track');renderTracks();paintPlayback();updateMediaSession();notify('nameSaved');});
$('#btn-edit-folder').onclick=()=>openAssign([editTrackId]);$('#btn-edit-pin').onclick=guarded(()=>toggleProperty(editTrackId,'pinned'));$('#btn-edit-priority').onclick=guarded(()=>toggleProperty(editTrackId,'priority'));$('#btn-edit-next').onclick=()=>nextRequested(editTrackId);
$('#btn-restart').onclick=()=>{if(confirm(t('restartConfirm'))){if(!queue.state||queue.current!==editTrackId)queue.start(currentRows().map(t=>t.id),{...listOptions,startId:editTrackId,context:context()});attachTrack(editTrackId,{restart:true});startAudio();saveQueue()?.catch(reportError);}};
$('#btn-delete-track').onclick=guarded(()=>deleteTracks([editTrackId]));$('#btn-player-edit').onclick=()=>openEdit(currentTrackId);
$('#mini-open').onclick=guarded(async()=>{showPanel('#full-player');await learning.open();});
$('#btn-mini-subtitle').onclick=guarded(async()=>{inlineSubtitles.setHidden(!inlineSubtitles.hidden);updateInsets();await setting('hideMiniSubtitle',inlineSubtitles.hidden);});
$('#btn-mini-play').onclick=togglePlay;$('#btn-play').onclick=togglePlay;$('#btn-close-player').onclick=guarded(()=>closePanel('#full-player'));
$('#btn-rewind').onclick=()=>seekTo(audio.currentTime-15);$('#btn-forward').onclick=()=>seekTo(audio.currentTime+15);$('#btn-prev').onclick=()=>advance(-1);$('#btn-next').onclick=()=>advance(1);
for(const selector of ['#seek-bar','#mini-seek']){
  const input=$(selector);input.onpointerdown=()=>{dragSeek=selector;};input.oninput=()=>{dragSeek=selector;updateTimeline();};
  const finish=()=>{const value=Number(input.value);dragSeek=null;if(Number.isFinite(audio.duration))seekTo(value/100*audio.duration);};
  input.onchange=finish;input.onpointerup=finish;input.onpointercancel=()=>{dragSeek=null;updateTimeline();};input.onblur=()=>{if(dragSeek===selector)finish();};
}
$('#speed-select').onchange=guarded(async()=>{captureProgress().catch(reportError);audio.playbackRate=Number($('#speed-select').value);await setting('speed',audio.playbackRate);updateMediaPosition();});
$('#btn-loop').onclick=()=>{repeatOne=!repeatOne;audio.loop=false;renderQueue();};
$('#btn-priority').onclick=guarded(()=>toggleProperty(currentTrackId,'priority'));$('#btn-note').onclick=openNote;
$('#note-input').oninput=e=>{pendingNote={id:noteTargetId,text:e.target.value,revision:++noteRevision};noteStatus='saving';$('#note-status').textContent=t(noteStatus);clearTimeout(noteTimer);noteTimer=setTimeout(()=>flushNote().catch(reportError),500);};
$('#btn-save-note').onclick=guarded(saveNote);
$('#btn-settings').onclick=()=>{showPanel('#modal-settings');storageStatus().catch(reportError);};$('#btn-persist').onclick=guarded(async()=>{await navigator.storage?.persist?.();await storageStatus();});
$('#btn-export').onclick=guarded(prepareBackup);$('#btn-download-backup').onclick=downloadBackup;$('#btn-share-backup').onclick=()=>navigator.share({files:[preparedBackup.file],title:'English Flow'}).catch(e=>{if(e.name!=='AbortError')reportError(e);});
$('#btn-import-backup').onclick=()=>$('#backup-input').click();$('#backup-input').onchange=guarded(async e=>{const file=e.target.files[0];e.target.value='';if(file)await importBackup(file);});
function closeSwipe(){swipeId=null;document.querySelectorAll('.swipe-right,.swipe-left').forEach(el=>el.classList.remove('swipe-right','swipe-left'));}
import {gestureDirection,isEdge} from './gestures.js';
let gesture=null,longPressTimer;
$('#tracks-list').addEventListener('pointerdown',e=>{
  const card=e.target.closest('.track-card');if(!card||e.target.closest('.swipe-actions')||e.button!==0||isEdge(e.clientX,window.innerWidth))return;
  gesture={id:card.dataset.id,x:e.clientX,y:e.clientY,direction:null,long:false,pointer:e.pointerId};
  if(!selectionMode)longPressTimer=setTimeout(()=>{if(gesture){gesture.long=true;suppressClickUntil=Date.now()+600;enterSelection(gesture.id);}},500);
});
$('#tracks-list').addEventListener('pointermove',e=>{
  if(!gesture||gesture.pointer!==e.pointerId)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y,direction=gestureDirection(dx,dy);
  if(Math.abs(dx)>8||Math.abs(dy)>8)clearTimeout(longPressTimer);
  if(direction==='vertical'){gesture=null;return;}
  if(!selectionMode&&direction)gesture.direction=direction;
});
$('#tracks-list').addEventListener('pointerup',e=>{
  clearTimeout(longPressTimer);if(!gesture)return;const g=gesture;gesture=null;
  if(g.long){suppressClickUntil=Date.now()+600;e.preventDefault();return;}
  if(!selectionMode&&g.direction&&Math.abs(e.clientX-g.x)>45){closeSwipe();swipeId={id:g.id,direction:g.direction};document.querySelectorAll('.track-card').forEach(card=>{if(card.dataset.id===g.id)card.classList.add('swipe-'+g.direction);});suppressClickUntil=Date.now()+400;e.preventDefault();}
});
$('#tracks-list').addEventListener('pointercancel',()=>{clearTimeout(longPressTimer);gesture=null;});
document.addEventListener('click',e=>{if(swipeId&&!e.target.closest(`.swipe-right,.swipe-left`)){closeSwipe();e.preventDefault();e.stopImmediatePropagation();}},true);
for(const panel of document.querySelectorAll('.modal')){
  panel.addEventListener('click',e=>{if(e.target===panel)closePanel('#'+panel.id).catch(reportError);});
  const handle=panel.querySelector('.sheet-handle');let startY=null,moved=false;
  handle.onpointerdown=e=>{startY=e.clientY;moved=false;handle.setPointerCapture(e.pointerId);};
  handle.onpointermove=e=>{if(startY!=null&&Math.abs(e.clientY-startY)>8)moved=true;};
  handle.onpointerup=e=>{const distance=startY==null?0:e.clientY-startY;startY=null;if(distance>60){e.preventDefault();closePanel('#'+panel.id).catch(reportError);}};
  handle.onpointercancel=()=>{startY=null;moved=true;};
  handle.onclick=()=>{if(!moved)closePanel('#'+panel.id).catch(reportError);};
}
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=guarded(()=>closePanel('#'+button.dataset.close)));
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();if(panels.length)closePanel().catch(reportError);else if(swipeId)closeSwipe();else if(selectionMode)exitSelection();}
  if(e.key==='Tab'&&panels.length){const panel=$(panels.at(-1)),items=[...panel.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
window.visualViewport?.addEventListener('resize',updateViewport);window.visualViewport?.addEventListener('scroll',updateViewport);window.addEventListener('resize',updateViewport);window.addEventListener('orientationchange',updateViewport);
if('ResizeObserver' in window){const observer=new ResizeObserver(updateInsets);observer.observe($('#player-bar'));observer.observe($('#batch-actions'));}
function saveSession(){captureProgress().catch(reportError);flushNote().catch(reportError);saveQueue()?.catch(reportError);}
document.addEventListener('visibilitychange',()=>{if(document.hidden)saveSession();});window.addEventListener('pagehide',saveSession);
window.addEventListener('online',()=>notify('online'));window.addEventListener('offline',()=>notify('offline'));
if('mediaSession' in navigator)for(const [action,handler] of Object.entries({play:()=>{if(audio.paused)togglePlay();},pause:()=>{captureProgress().catch(reportError);audio.pause();},seekbackward:e=>seekTo(audio.currentTime-(e.seekOffset||15)),seekforward:e=>seekTo(audio.currentTime+(e.seekOffset||15)),seekto:e=>seekTo(e.seekTime),previoustrack:()=>advance(-1),nexttrack:()=>advance(1)}))try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
try{if(navigator.audioSession)navigator.audioSession.type='playback';}catch{}
$('#btn-update').onclick=guarded(async()=>{
  if(busy){notify('busyWait');return;}if(!audio.paused||noteOpen()||(learning?.hasDraft()||phrasebook?.hasDraft())){notify('updatePause');return;}
  await flushNote();await captureProgress();await saveQueue();
  if(!pendingWorker||['activated','redundant'].includes(pendingWorker.state)){location.reload();return;}
  updateRequested=true;pendingWorker.postMessage({type:'SKIP_WAITING'});
});
async function initServiceWorker(){
  if(!('serviceWorker' in navigator)){offlineStatus='offlineUnsupported';$('#offline-status').textContent=t(offlineStatus);return;}
  try{
    const registration=await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'});
    registration.update().catch(console.error);
    const announceUpdate=()=>{if(registration.waiting){pendingWorker=registration.waiting;if(navigator.serviceWorker.controller)show('#update-banner');}};announceUpdate();registration.addEventListener('updatefound',()=>{registration.installing?.addEventListener('statechange',announceUpdate);});
    let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested&&!reloading){reloading=true;location.reload();}});
    await navigator.serviceWorker.ready;const scope=registration.scope,keys=await caches.keys();
    const available=await Promise.all(keys.filter(key=>key.startsWith(`english-flow-shell:${new URL(scope).pathname}:`)).map(async key=>{const cache=await caches.open(key);return !!(await cache.match(new URL('index.html',scope).href));}));
    offlineStatus=available.some(Boolean)?'offlineReady':'offlinePending';
  }catch(error){offlineStatus='offlineFailed';console.error(error);}$('#offline-status').textContent=t(offlineStatus);
}
async function loadSettings(){
  const settings=new Map((await library.all('settings')).map(row=>[row.id,row.value]));setLanguage(settings.get('language'));
  inlineSubtitles.setHidden(settings.get('hideMiniSubtitle')===true);
  sortMode=SORT_MODES.includes(settings.get('sort'))?settings.get('sort'):'newest';
  const speed=settings.get('speed');if([0.75,1,1.25,1.5,1.75,2].includes(speed))$('#speed-select').value=String(speed);
  const options=settings.get('listOptions');if(options&&[0,1,2,3].includes(options.total))listOptions={shuffle:options.shuffle===true,total:options.total};
  const saved=settings.get('queue');if(saved&&['source','remaining','history','manual','visited','failed'].every(k=>Array.isArray(saved[k]))&&Number.isInteger(saved.cursor)){queue=new PlaybackQueue(saved);queue.prune(tracks.map(t=>t.id));}
  const last=settings.get('lastTrack');if(byId(queue.current||last))attachTrack(queue.current||last);
  localize();renderTracks(true);
}
async function init(){
  setBusy(true);localize();updateViewport();
  try{library=await openLibrary();await refreshLibrary();await loadSettings();setBusy(false);notify(tracks.length?'libraryLoaded':'addHint');storageStatus().catch(reportError);}catch(error){reportError(error);$('#status').textContent+=' '+t('dbFailed');}
  initServiceWorker();
}
learning=new LearningPlayer({onSubtitle:(id,segments,time)=>inlineSubtitles.update(id,segments,time),audio,library:()=>library,getTrack:byId,getBlob:id=>blobs.get(id),notify,reportError,setBusy,openPanel:showPanel,closePanel,seek:seconds=>{if(mediaReady)seekTo(seconds,false);else resumeAt=seconds;},play:startAudio,finishNote:async()=>{await flushNote();if(pendingNote)return false;$('#note-input').blur();hide('#note-area');return true;}});
phrasebook=new Phrasebook({library:()=>library,currentTrack:()=>currentTrackId,getTrack:byId,patchTrack,openPanel:showPanel,closePanel,reportError,notify,playSegment:async(track,segment)=>{if(currentTrackId!==track)attachTrack(track);showPanel('#full-player');await learning.open();learning.jump(segment,'once');}});
$('#btn-player-tab').onclick=guarded(async()=>{await flushNote();if(!pendingNote){hide('#note-area');learning.hide();}});
init();
