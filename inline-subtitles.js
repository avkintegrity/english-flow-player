import {activeSegment} from './transcript.js';
import {t} from './i18n.js';

// Text only: this presenter never replaces cards, changes order or seeks audio.
export class InlineSubtitles {
 constructor(root=document){this.root=root;this.hidden=false;this.trackId=null;this.segments=[];this.time=0;}
 update(trackId,segments,time){this.trackId=trackId;this.segments=segments;this.time=time;this.render();}
 setHidden(value){this.hidden=!!value;this.render();}
 render(){
  const segment=this.segments[activeSegment(this.segments,this.time)];
  const text=segment?.en||t(this.segments.length?'subtitleGap':'textNotCreated');
  const set=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value;};
  for(const card of this.root.querySelectorAll('.track-card')){
   const active=card.dataset.id===this.trackId,box=card.querySelector('.inline-subtitle');
   if(!box)continue;
   box.classList.toggle('hidden',!active);
   set(box.querySelector('p'),active?text:'');
   box.querySelector('p').lang=segment?'en':'';
   box.querySelector('[data-action="text"]').classList.toggle('hidden',!!this.segments.length);
  }
  const mini=this.root.querySelector('#mini-subtitle'),toggle=this.root.querySelector('#btn-mini-subtitle');
  if(mini){mini.classList.toggle('hidden',this.hidden);set(mini,this.trackId?text:'');mini.lang=segment?'en':'';}
  if(toggle){toggle.setAttribute('aria-pressed',String(!this.hidden));toggle.setAttribute('aria-expanded',String(!this.hidden));set(toggle,t(this.hidden?'showSubtitle':'hideSubtitle'));}
 }
}
