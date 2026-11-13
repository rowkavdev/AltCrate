const path=require('node:path');const os=require('node:os');const fs=require('node:fs/promises');const crypto=require('node:crypto');const {spawn}=require('node:child_process');const {isIP}=require('node:net');
function safePath(value){if(typeof value!=='string'||!path.isAbsolute(value)||value.length>1024||/[\x00-\x1f\x7f;`$|&<>]/.test(value))throw Error('Caminho do servidor inválido');return value;}
function validateServerProfile(value={}){
 if(/\.pub$/i.test(String(value.keyPath||'')))throw Error('Escolhe a chave privada SSH, sem a extensão .pub.');
 const host=String(value.host||'').trim();if(!isIP(host)&&!(/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)&&!host.includes('..')))throw Error('Endereço do servidor inválido');
 const port=Number(value.port??22);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Porta SSH inválida');
 if(typeof value.user!=='string'||! /^[a-z_][a-z0-9_-]{0,31}$/i.test(value.user))throw Error('Utilizador SSH inválido');
 const serviceName=value.serviceName||'casepilot-farm';if(typeof serviceName!=='string'||!/^[a-z0-9-]{1,64}$/.test(serviceName))throw Error('Nome de serviço inválido');
 const name=String(value.name||host).trim();if(!name||name.length>80||/[\x00-\x1f]/.test(name))throw Error('Nome do servidor inválido');
 return {version:1,name,host,port,serviceName,user:value.user,keyPath:safePath(value.keyPath),knownHostsPath:safePath(value.knownHostsPath),nodePath:safePath(value.nodePath||'/usr/bin/node'),controlPath:safePath(value.controlPath||'/opt/casepilot-farm/serverFarmControl.cjs'),dataDirectory:safePath(value.dataDirectory||'/var/lib/casepilot-farm')};
}
const shellQuote=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const profileId=value=>crypto.createHash('sha256').update(JSON.stringify([value.host,value.port,value.user,value.keyPath,value.knownHostsPath])).digest('hex').slice(0,24);
const sshProgram=()=>process.platform==='win32'?'ssh':'/usr/bin/ssh';
const sshOptionQuote=value=>'"'+String(value).replace(/%/g,'%%').replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
const workerDestinationId=value=>{const p=validateServerProfile(value);return crypto.createHash('sha256').update(JSON.stringify([p.host,p.port,p.user,p.nodePath,p.controlPath,p.dataDirectory])).digest('hex');};
function sshArguments(profile){const p=validateServerProfile(profile);return ['-F',process.platform==='win32'?'NUL':'/dev/null','-p',String(p.port),'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',...(process.platform==='win32'?[]:['-o','ControlMaster=auto','-o','ControlPersist=600','-o','ControlPath='+sshOptionQuote(path.join(os.tmpdir(),'casepilot-'+profileId(p)))]),'-o','UserKnownHostsFile='+sshOptionQuote(p.knownHostsPath),'-i',p.keyPath,p.user+'@'+p.host,'CASEPILOT_SERVER_DATA='+shellQuote(p.dataDirectory)+' '+shellQuote(p.nodePath)+' '+shellQuote(p.controlPath)];}
const fingerprint=key=>'SHA256:'+crypto.createHash('sha256').update(Buffer.from(key,'base64')).digest('base64').replace(/=+$/,'');
function probeServerIdentity(profile,{spawnProcess=spawn}={}){const p=validateServerProfile(profile);return new Promise((resolve,reject)=>{
 const child=spawnProcess(process.platform==='win32'?'ssh-keyscan':'/usr/bin/ssh-keyscan',['-T','5','-p',String(p.port),'-t','ed25519,rsa,ecdsa',p.host],{stdio:['ignore','pipe','pipe']});let output='',done=false;const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};const timer=setTimeout(()=>{child.kill();finish(Error('Não foi possível verificar a identidade do servidor'));},10000);
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>65536){child.kill();finish(Error('Resposta de identidade inválida'));}});child.stderr.on('data',()=>{});child.on('error',()=>finish(Error('SSH indisponível neste computador')));child.on('close',code=>{const candidates=output.split('\n').filter(line=>line&&!line.startsWith('#')).map(line=>line.trim().split(/\s+/)).filter(parts=>parts.length===3&&/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521))$/.test(parts[1])&&/^[A-Za-z0-9+/]+={0,2}$/.test(parts[2])).map(([,type,key])=>({type,key,fingerprint:fingerprint(key)}));if(code!==0||!candidates.length)finish(Error('O servidor não apresentou uma identidade SSH'));else finish(null,candidates);});
});}
async function trustServerIdentity(profile,expectedFingerprint,{candidates}={}){
 const p=validateServerProfile(profile);const keys=candidates||await probeServerIdentity(p);const chosen=keys.find(key=>fingerprint(key.key)===expectedFingerprint);if(!chosen)throw Error('A identidade apresentada já não corresponde à escolhida');
 let existing='';try{existing=await fs.readFile(p.knownHostsPath,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
 const host=p.port===22?p.host:`[${p.host}]:${p.port}`;const line=host+' '+chosen.type+' '+chosen.key+'\n';
 if(existing.trim()&&existing!==line)throw Error('A identidade SSH mudou. Verifica o servidor antes de substituir a associação.');
 await fs.mkdir(path.dirname(p.knownHostsPath),{recursive:true,mode:0o700});await fs.writeFile(p.knownHostsPath,line,{mode:0o600});await fs.chmod(p.knownHostsPath,0o600);return {trusted:true,fingerprint:expectedFingerprint};
}
module.exports={validateServerProfile,sshArguments,sshProgram,profileId,workerDestinationId,probeServerIdentity,trustServerIdentity,shellQuote};
