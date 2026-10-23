// The playback snapshot is independent of library sorting and live counters.
export const unique = values => [...new Set(values)];
export function shuffleIds(ids, random=Math.random, avoidFirst=null) {
  const out=unique(ids);
  for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  if(out.length>1&&out[0]===avoidFirst)[out[0],out[1]]=[out[1],out[0]];
  return out;
}
export class PlaybackQueue {
  constructor(state=null, random=Math.random){this.random=random;this.state=state?structuredClone(state):null;}
  start(ids,{startId=null,shuffle=false,total=1,context='all'}={}) {
    const source=unique(ids);if(!source.length){this.state=null;return null;}
    let order=shuffle?shuffleIds(source,this.random):[...source];
    let skipped=[];
    if(startId&&source.includes(startId)){
      if(shuffle)order=[startId,...order.filter(id=>id!==startId)];
      else {const index=order.indexOf(startId);skipped=order.slice(0,index);order=order.slice(index);}
    }
    const current=order.shift();
    this.state={source,remaining:order,manual:[],visited:[...skipped,current],history:[current],cursor:0,pass:1,total,shuffle,context,ended:false,failed:[]};
    return current;
  }
  get current(){return this.state?.history[this.state.cursor]||null;}
  next(){
    const s=this.state;if(!s)return null;
    if(s.cursor<s.history.length-1)return s.history[++s.cursor];
    let id=s.manual.shift()||s.remaining.shift();
    if(!id){
      if(s.total!==0&&s.pass>=s.total){s.ended=true;return null;}
      const eligible=s.source.filter(id=>!s.failed.includes(id));
      if(!eligible.length){s.ended=true;return null;}
      s.pass++;s.visited=[];
      s.remaining=s.shuffle?shuffleIds(eligible,this.random,this.current):[...eligible];
      id=s.remaining.shift();
    }
    s.remaining=s.remaining.filter(x=>x!==id);s.visited=unique([...s.visited,id]);
    s.history.push(id);s.cursor=s.history.length-1;s.ended=false;return id;
  }
  previous(){const s=this.state;if(!s||s.cursor<=0)return null;s.ended=false;return s.history[--s.cursor];}
  playNext(id){
    const s=this.state;if(!s)return false;
    // After Previous, forward history is replay, not a new automatic shuffle pass.
    // An explicit Play Next still takes precedence and does not duplicate that history.
    const forward=s.history.slice(s.cursor+1);s.history=s.history.slice(0,s.cursor+1);
    s.manual=unique([id,...s.manual,...forward]);
    s.remaining=s.remaining.filter(x=>!s.manual.includes(x));s.ended=false;return true;
  }
  setShuffle(enabled){
    const s=this.state;if(!s)return;
    s.shuffle=enabled;
    const left=new Set(s.remaining);
    s.remaining=enabled?shuffleIds(s.remaining,this.random):s.source.filter(id=>left.has(id));
  }
  setTotal(total){if(this.state)this.state.total=total;}
  fail(id){const s=this.state;if(!s)return;s.failed=unique([...s.failed,id]);s.remaining=s.remaining.filter(x=>x!==id);s.manual=s.manual.filter(x=>x!==id);}
  prune(valid){
    const s=this.state;if(!s)return;
    const keep=new Set(valid),old=s.history[s.cursor];
    for(const key of ['source','remaining','manual','visited','failed'])s[key]=s[key].filter(id=>keep.has(id));
    const before=s.history.slice(0,s.cursor+1).filter(id=>keep.has(id));
    s.history=s.history.filter(id=>keep.has(id));s.cursor=Math.max(0,before.length-1);
    if(!s.source.length&&!s.manual.length)this.state=null;
    return old;
  }
}
