'use strict';
const readline=require('node:readline');
const platform=require('./platform.cjs');
let serviceStarted=false;
// stdout carries the framed transport only. Never mix debugging or secrets into it.
console.log=(...args)=>process.stderr.write(args.map(String).join(' ')+'\n');
readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',line=>{
  if(Buffer.byteLength(line)>16*1024*1024){platform.fatal(Error('Pedido demasiado grande'));return;}
  try{
    const message=JSON.parse(line);
    void platform.receive(message).catch(platform.fatal);
    if(message.type==='initialize'&&!serviceStarted){serviceStarted=true;require('./service.cjs');}
  }catch(error){platform.fatal(error);}
}).on('close',()=>platform.lifecycle.quit());
