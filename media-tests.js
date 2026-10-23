import {newPass,consumePlayed,nativeRanges} from './listening.js';
const output=document.querySelector('#results'),audio=document.querySelector('#test-audio');
function wav(){const sampleRate=8000,seconds=4,buffer=new ArrayBuffer(44+sampleRate*seconds*2),v=new DataView(buffer),text=(offset,str)=>[...str].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));text(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);text(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);text(36,'data');v.setUint32(40,buffer.byteLength-44,true);return new Blob([buffer],{type:'audio/wav'});}
const url=URL.createObjectURL(wav());audio.src=url;
const once=event=>new Promise(resolve=>audio.addEventListener(event,resolve,{once:true}));
function assert(value,message){if(!value)throw new Error(message);output.textContent+='PASS '+message+'\n';}
document.querySelector('#run').onclick=async()=>{
 output.textContent='Running…\n';document.querySelector('#run').disabled=true;
 try{
  let pass=newPass(),credits=0;audio.currentTime=0;audio.playbackRate=2;
  const onTime=()=>{const r=consumePlayed(pass,nativeRanges(audio),audio.duration);pass=r.pass;credits+=Number(r.credit);};audio.addEventListener('timeupdate',onTime);
  const ended=once('ended');await audio.play();assert(credits===0,'Play does not count');await ended;onTime();audio.removeEventListener('timeupdate',onTime);
  assert(credits===1,'Actual 2× playback covers 90% once, including ended');assert(consumePlayed(JSON.parse(JSON.stringify(pass)),nativeRanges(audio),audio.duration).credit===false,'Restored pass does not count twice');
  audio.load();await once('loadedmetadata');pass=newPass();audio.currentTime=audio.duration*.95;await once('seeked');const seekEnd=once('ended');await audio.play();await seekEnd;
  const skipped=consumePlayed(pass,nativeRanges(audio),audio.duration);assert(!skipped.credit&&skipped.covered<1,'Seeking to 95% does not count skipped audio');
  output.textContent+='\n4/4 native audio tests passed';
 }catch(error){output.textContent+='FAIL '+error.message;console.error(error);}finally{document.querySelector('#run').disabled=false;}
};
