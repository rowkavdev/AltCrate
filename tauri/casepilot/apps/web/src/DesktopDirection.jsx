import React, {useState, useEffect} from 'react';
import {Direction} from 'radix-ui';
const KEY='casepilot:direction';
export function setDirection(next){if(!['ltr','rtl'].includes(next))return;localStorage.setItem(KEY,next);window.dispatchEvent(new Event('casepilot-direction'));}
export function DesktopDirection({children}){
  const [direction,set]=useState(()=>localStorage.getItem(KEY)||'ltr');
  useEffect(()=>{const update=()=>set(localStorage.getItem(KEY)||'ltr');window.addEventListener('casepilot-direction',update);return()=>window.removeEventListener('casepilot-direction',update);},[]);
  useEffect(()=>{document.documentElement.dir=direction;},[direction]);
  return <Direction.Provider dir={direction}>{children}</Direction.Provider>;
}
export function DirectionSetting(){
  const [direction,set]=useState(()=>localStorage.getItem(KEY)||'ltr');
  return <label className="direction-setting">Interface direction<select aria-label="Interface direction" value={direction} onChange={event=>{set(event.target.value);setDirection(event.target.value);}}><option value="ltr">Left to right</option><option value="rtl">Right to left (RTL)</option></select></label>;
}
