import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const code=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
function worker(){
 const events={},deleted=[],requests=[],responses=[];let claimed=false,skipped=false;
 const scope='https://example.github.io/english-flow-player/';
 const cache={addAll:async reqs=>requests.push(...reqs),match:async req=>new Response('cached '+req)};
 const context={URL,Request,Response,Set,Promise,fetch:async req=>new Response('network'),caches:{open:async()=>cache,keys:async()=>['unrelated-site-cache','english-flow-shell:/other/:old','english-flow-shell:/english-flow-player/:old'],delete:async name=>deleted.push(name)},self:{registration:{scope},location:{origin:'https://example.github.io'},addEventListener:(type,handler)=>{events[type]=handler;},skipWaiting:()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}}};
 vm.runInNewContext(code,context);
 return {events,deleted,requests,scope,get claimed(){return claimed;},get skipped(){return skipped;}};
}
test('Install caches the complete subpath shell including icons and modules',async()=>{
 const w=worker();let promise;w.events.install({waitUntil:p=>promise=p});await promise;
 assert.equal(w.requests.length,19);
 for(const req of w.requests)assert.ok(req.url.startsWith(w.scope));
 for(const file of ['inline-subtitles.js','transcript.js','fingerprint.js','learning-player.js','app.js','db.js','backup.js','core.js','queue.js','listening.js','i18n.js','gestures.js','icon-192.png','icon-512.png'])assert.ok(w.requests.some(r=>r.url.endsWith(file)));
 assert.equal(w.skipped,false);
});
test('Activation removes only old caches inside this app scope',async()=>{
 const w=worker();let promise;w.events.activate({waitUntil:p=>promise=p});await promise;
 assert.deepEqual(w.deleted,['english-flow-shell:/english-flow-player/:old']);assert.equal(w.claimed,true);
});
test('Worker update activation requires an explicit app message',()=>{
 const w=worker();w.events.message({data:{type:'UNKNOWN'}});assert.equal(w.skipped,false);
 w.events.message({data:{type:'SKIP_WAITING'}});assert.equal(w.skipped,true);
});
test('Fetch routes only own shell; does not capture other apps, POST or nested pages',async()=>{
 const w=worker();
 for(const req of [{url:'https://example.github.io/other/',method:'GET',mode:'navigate'},{url:w.scope+'tests/browser.html',method:'GET',mode:'navigate'},{url:w.scope,method:'POST',mode:'navigate'},{url:'https://third-party.invalid/',method:'GET',mode:'navigate'}]){
  let intercepted=false;w.events.fetch({request:req,respondWith:()=>intercepted=true});assert.equal(intercepted,false);
 }
 let response;w.events.fetch({request:{url:w.scope,method:'GET',mode:'navigate'},respondWith:p=>response=p});
 assert.match(await (await response).text(),/cached .*english-flow-player\/index.html/);
});
