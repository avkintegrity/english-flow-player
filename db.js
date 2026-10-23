// Keep the original database name and migrate v1 in one atomic upgrade.
export const DB_NAME = 'english-flow-db';
export const DB_VERSION = 2;
export function openLibrary(name = DB_NAME) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DB_VERSION);
    let blocked = false;
    request.onblocked = () => { blocked = true; reject(new Error('Закройте другие окна English Flow и откройте приложение заново для обновления хранилища.')); };
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['tracks', 'folders', 'audio', 'settings']) {
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
          row.update({...track, size: blob.size, type: blob.type});
        }
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
      tx.onabort = () => reject(tx.error || new Error('Изменения не сохранены.'));
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
  addTrack(track, blob) {
    return this.transaction(['tracks', 'audio'], 'readwrite', tx => {
      tx.objectStore('tracks').add(track);
      tx.objectStore('audio').add({id:track.id, blob});
    });
  }
  removeTrack(id) {
    return this.transaction(['tracks','audio'], 'readwrite', tx => {
      tx.objectStore('tracks').delete(id);
      tx.objectStore('audio').delete(id);
    });
  }
  removeFolder(id) {
    return this.transaction(['tracks','folders'], 'readwrite', tx => {
      tx.objectStore('folders').delete(id);
      const cursor = tx.objectStore('tracks').openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        if (row.value.folderId === id) row.update({...row.value, folderId:null});
        row.continue();
      };
    });
  }
  snapshot() {
    return this.transaction(['tracks','folders','audio'], 'readonly', tx => {
      const tracks = tx.objectStore('tracks').getAll();
      const folders = tx.objectStore('folders').getAll();
      const audio = tx.objectStore('audio').getAll();
      return () => ({tracks:tracks.result, folders:folders.result, audio:audio.result});
    });
  }
  restore({tracks, folders, audio}) {
    // Additive and all-or-nothing; existing recordings are never cleared.
    return this.transaction(['tracks','folders','audio'], 'readwrite', tx => {
      for (const folder of folders) tx.objectStore('folders').add(folder);
      for (const track of tracks) tx.objectStore('tracks').add(track);
      for (const row of audio) tx.objectStore('audio').add(row);
    });
  }
}
