// Keep vertical scroll and system edge gestures outside the card gesture handler.
export function gestureDirection(dx,dy){if(Math.abs(dy)>8&&Math.abs(dy)>=Math.abs(dx))return 'vertical';if(Math.abs(dx)>14&&Math.abs(dx)>Math.abs(dy)*1.4)return dx>0?'right':'left';return null;}
export const isEdge=(x,width)=>x<24||x>width-24;
