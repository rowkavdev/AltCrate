import {useState} from 'react';
export function useGameField(ui,onUiChange,key,initial){
 const [local,setLocal]=useState(initial);
 const value=ui&&Object.hasOwn(ui,key)?ui[key]:local;
 function update(next){const resolved=typeof next==='function'?next(value):next;setLocal(resolved);onUiChange?.({[key]:resolved});}
 return [value,update];
}
