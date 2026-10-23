// Union of the browser's native played ranges: seeks, pauses and waiting add no coverage.
export function mergeRanges(ranges, duration = Infinity) {
  const sorted = ranges.filter(r=>Array.isArray(r)&&r.length===2&&r.every(Number.isFinite))
    .map(([a,b])=>[Math.max(0,a),Math.min(duration,b)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
  const result=[];
  for(const range of sorted){const last=result.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else result.push([...range]);}
  return result;
}
export function newPass() { return {id:crypto.randomUUID(),ranges:[],counted:false,ended:false}; }
export function consumePlayed(pass, ranges, duration) {
  const merged=mergeRanges([...(pass.ranges||[]),...ranges],duration>0?duration:Infinity);
  const covered=merged.reduce((sum,[a,b])=>sum+b-a,0);
  const credit=!pass.counted&&Number.isFinite(duration)&&duration>0&&covered/duration>=0.9;
  return {pass:{...pass,ranges:merged,counted:!!pass.counted||credit},credit,covered};
}
export function nativeRanges(audio) {
  const result=[],ranges=audio.played;
  for(let i=0;i<ranges.length;i++)result.push([ranges.start(i),ranges.end(i)]);
  return result;
}
