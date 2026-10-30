export const TRANSCRIPT_FORMAT='english-flow-transcript';
export const MAX_TEXT_BYTES=16*1024*1024;
const fail=key=>{throw new Error(key);};
const validText=(v,n=20000)=>typeof v==='string'&&v.length<=n;
export function validateTranscript(input){
 if(!input||input.format!==TRANSCRIPT_FORMAT||input.version!==1||!Array.isArray(input.segments)||!input.segments.length||input.segments.length>20000)fail('transcriptInvalid');
 const a=input.audio;
 if(!a||!Number.isFinite(a.duration)||a.duration<=0||a.duration>86400*7||!Number.isSafeInteger(a.size)||a.size<0||(a.sha256!=null&&!/^[a-f0-9]{64}$/.test(a.sha256)))fail('transcriptInvalid');
 let end=0;const ids=new Set();
 const segments=input.segments.map((s,i)=>{
  if(!s||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.start<end-0.001||s.end>a.duration+0.25||!validText(s.en)||!s.en.trim()||!validText(s.ru??''))fail('transcriptInvalid');
  const id=String(s.id??'s'+i);if(!id||id.length>200||ids.has(id))fail('transcriptInvalid');ids.add(id);end=s.end;
  return {id,start:s.start,end:s.end,en:s.en.trim(),ru:(s.ru||'').trim()};
 });
 return {format:TRANSCRIPT_FORMAT,version:1,audio:{sha256:a.sha256||null,size:a.size,duration:a.duration,name:validText(a.name,1000)?a.name:''},timing:'segment',source:validText(input.source,200)?input.source:'import',segments};
}
function stamp(s){const m=s.match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);if(!m||+m[2]>59||+m[3]>59)fail('transcriptInvalid');return (+m[1]||0)*3600+(+m[2])*60+(+m[3])+(+m[4])/1000;}
export function parseSubtitles(text,duration){
 const blocks=text.replace(/^\uFEFF/,'').replace(/\r/g,'').split(/\n\s*\n/),segments=[];
 for(const block of blocks){const lines=block.trim().split('\n'),n=lines.findIndex(l=>l.includes('-->'));if(n<0)continue;const parts=lines[n].trim().split(/\s+-->\s+/);if(parts.length!==2)fail('transcriptInvalid');const start=stamp(parts[0]),end=stamp(parts[1].split(/\s/)[0]);const en=lines.slice(n+1).join(' ').replace(/<[^>]*>/g,'').trim();if(en)segments.push({id:'s'+segments.length,start,end,en,ru:''});}
 return validateTranscript({format:TRANSCRIPT_FORMAT,version:1,audio:{size:0,duration,sha256:null},source:'subtitles-unverified',segments});
}
export async function parseTranscriptFile(file,duration){if(file.size>MAX_TEXT_BYTES)fail('transcriptLarge');const text=await file.text();if(/\.(srt|vtt)$/i.test(file.name))return {transcript:parseSubtitles(text,duration),verified:false,phrases:[]};let input;try{input=JSON.parse(text);}catch{fail('transcriptInvalid');}const transcript=validateTranscript(input);if(!transcript.audio.sha256)fail('transcriptFingerprintRequired');return {transcript,verified:true,phrases:validatePhrases(input.phrases||[],transcript)};}
export function checkAudioMatch(transcript,{sha256,size,duration}){const a=transcript.audio;if(a.sha256&&(a.sha256!==sha256||a.size!==size))fail('transcriptMismatch');if(!Number.isFinite(duration)||duration<=0||Math.abs(a.duration-duration)>Math.max(0.5,duration*0.005))fail('transcriptDuration');return true;}
export function activeSegment(segments,time){let low=0,high=segments.length-1;while(low<=high){const mid=(low+high)>>1,s=segments[mid];if(time<s.start)high=mid-1;else if(time>=s.end)low=mid+1;else return mid;}return -1;}
export function closestSegment(segments,time){const current=activeSegment(segments,time);if(current!==-1)return current;const next=segments.findIndex(s=>s.start>=time);return next<0?segments.length-1:next;}
export function findSegments(segments,query){const q=query.trim().toLocaleLowerCase();return segments.filter(s=>!q||(s.en+'\n'+s.ru).toLocaleLowerCase().includes(q));}
export function validatePhrases(items,transcript){
 if(!Array.isArray(items)||items.length>2000)fail('transcriptInvalid');const ids=new Set();
 return items.map((item,i)=>{const s=transcript?.segments.find(s=>s.id===item?.segmentId);if(!item||!validText(item.expression,500)||!item.expression.trim()||!validText(item.meaning,3000)||!validText(item.pronunciation||'',500)||!s||!s.en.toLowerCase().includes(item.expression.trim().toLowerCase()))fail('transcriptPhraseInvalid');const id=String(item.id||'p'+i);if(ids.has(id)||id.length>200)fail('transcriptInvalid');ids.add(id);return {id,segmentId:s.id,expression:item.expression.trim(),meaning:item.meaning.trim(),pronunciation:item.pronunciation||'',context:s.en,time:s.start,known:item.known===true,saved:item.saved===true};});
}
export function validateLearning(value){if(!value||!value.transcript)fail('transcriptInvalid');const transcript=validateTranscript(value.transcript);return {transcript,phrases:validatePhrases(value.phrases||[],transcript)};}
// A sentence drill only affects the current media element; it never changes a queue.
export class SentenceDrill {
 constructor(){this.clear();}
 clear(){this.mode='off';this.segment=null;}
 start(segment,mode='once'){this.segment=segment;this.mode=mode;}
 boundary(time){if(!this.segment||this.mode==='off'||time<this.segment.end-0.025)return null;if(this.mode==='loop')return {seek:this.segment.start};const end=this.segment.end;this.clear();return {pause:true,seek:end};}
}
