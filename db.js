import {normalizeTrack, applyFolderChanges, folderIds} from './core.js';
import {newPass, consumePlayed} from './listening.js';
// Keep the original database name and migrate v1 in one atomic upgrade.
export const DB_NAME = 'english-flow-db';
export const DB_VERSION = 4;
export function openLibrary(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('dbBlocked')); };
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['tracks', 'folders', 'audio', 'settings', 'learning']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, {keyPath: 'id'});
      }
      // Metadata edits no longer re-write a potentially large audio Blob.
      const cursor = request.transaction.objectStore('tracks').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const {blob, ...track} = row.value;
        if (blob instanceof Blob) {
          request.transaction.objectStore('audio').put({id: track.id, blob});
          track.size=blob.size;track.type=blob.type;
        }
        row.update({...normalizeTrack(track),listen:track.listen||newPass(),phrases:track.phrases||{status:'not-connected',items:[]}});
        row.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(new Library(db));
    };
  });
}
export class Library {
  constructor(db) { this.db = db; }
  // Resolve only after commit, including deletes, restores and quota failures.
  transaction(stores, mode, schedule) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(typeof result === 'function' ? result() : result);
      tx.onabort = () => reject(tx.error || new Error('saveFailed'));
      tx.onerror = () => {}; // The abort event is the final transaction outcome.
      try { result = schedule(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  all(store) {
    return this.transaction([store], 'readonly', tx => {
      const req = tx.objectStore(store).getAll();
      return () => req.result;
    });
  }
  get(store, id) {
    return this.transaction([store], 'readonly', tx => {
      const req = tx.objectStore(store).get(id);
      return () => req.result;
    });
  }
  put(store, value) { return this.transaction([store], 'readwrite', tx => { tx.objectStore(store).put(value); }); }
  patchTrack(id, patch) {
    return this.transaction(['tracks'], 'readwrite', tx => {
      const store = tx.objectStore('tracks');
      const req = store.get(id);
      let result;
      req.onsuccess = () => {
        if (!req.result) return; // A late position/note save must not resurrect a deleted track.
        result = {...req.result, ...patch, id};
        store.put(result);
      };
      return () => result;
    });
  }
  putLearning(id, value) {
    return this.transaction(['tracks','learning'], 'readwrite', tx=>{
      const req=tx.objectStore('tracks').get(id);let saved=false;
      req.onsuccess=()=>{if(req.result){tx.objectStore('learning').put({...value,id});saved=true;}};
      return ()=>saved;
    });
  }
  addTrack(track, blob) {
    return this.transaction(['tracks', 'audio'], 'readwrite', tx => {
      tx.objectStore('tracks').add({...normalizeTrack(track),listen:track.listen||newPass()});
      tx.objectStore('audio').add({id:track.id, blob});
    });
  }
  updateTracks(ids, update) {
    return this.transaction(['tracks'], 'readwrite', tx=>{
      const store=tx.objectStore('tracks'),results=[];
      for(const id of new Set(ids)){
        const req=store.get(id);req.onsuccess=()=>{if(req.result){const row={...req.result,...update(req.result),id};store.put(row);results.push(row);}};
      }
      return ()=>results;
    });
  }
  assignFolders(ids, changes) { return this.updateTracks(ids,track=>({folderIds:applyFolderChanges(track,changes)})); }
  recordProgress(id, passId, ranges, duration, position, ended=false) {
    return this.updateTracks([id],track=>{
      if(track.listen?.id!==passId)return {};
      const result=consumePlayed(track.listen,ranges,duration);
      return {listen:{...result.pass,ended:track.listen.ended||ended},duration:duration>0?duration:track.duration,lastPosition:position,playCount:(track.playCount||0)+Number(result.credit)};
    }).then(rows=>rows[0]);
  }
  removeTracks(ids) {
    return this.transaction(['tracks','audio','learning'], 'readwrite',tx=>{for(const id of ids){tx.objectStore('tracks').delete(id);tx.objectStore('audio').delete(id);tx.objectStore('learning').delete(id);}});
  }
  removeTrack(id) {
    return this.transaction(['tracks','audio','learning'], 'readwrite', tx => {
      tx.objectStore('tracks').delete(id);
      tx.objectStore('audio').delete(id);
      tx.objectStore('learning').delete(id);
    });
  }
  removeFolder(id) {
    return this.transaction(['tracks','folders'], 'readwrite', tx => {
      tx.objectStore('folders').delete(id);
      const cursor = tx.objectStore('tracks').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (folderIds(row.value).includes(id)) row.update({...normalizeTrack(row.value),folderIds:folderIds(row.value).filter(value=>value!==id)});
        row.continue();
      };
    });
  }
  snapshot() {
    return this.transaction(['tracks','folders','audio','settings','learning'], 'readonly', tx => {
      const tracks = tx.objectStore('tracks').getAll();
      const folders = tx.objectStore('folders').getAll();
      const audio = tx.objectStore('audio').getAll();
      const settings = tx.objectStore('settings').getAll();
      const learning = tx.objectStore('learning').getAll();
      return () => ({tracks:tracks.result, folders:folders.result, audio:audio.result,settings:settings.result,learning:learning.result});
    });
  }
  restore({tracks, folders, audio, settings=[], learning=[]}, restoreSettings=false) {
    // Additive and all-or-nothing; existing recordings are never cleared.
    return this.transaction(['tracks','folders','audio','settings','learning'], 'readwrite', tx => {
      for (const folder of folders) tx.objectStore('folders').add(folder);
      for (const track of tracks) tx.objectStore('tracks').add({...normalizeTrack(track),listen:track.listen||newPass()});
      for (const row of audio) tx.objectStore('audio').add(row);
      for (const row of learning) tx.objectStore('learning').add(row);
      if(restoreSettings)for(const setting of settings)tx.objectStore('settings').put(setting);
    });
  }
}
