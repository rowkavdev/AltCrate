const path=require('node:path');const os=require('node:os');const {validateServerProfile}=require('./serverFarmProfile.cjs');
async function migrateLegacyFarmConfig(config,{readSources,home=os.homedir()}={}){
 if(!config?.enabled||config.profile)return config||{};
 if(typeof config.host!=='string'||!readSources)throw Error('Configura a ligação ao farm existente antes de continuar');
 for(const source of await readSources()){
  const target=[...String(source).matchAll(/['"]([a-z_][a-z0-9_-]{0,31})@([^'"\s]+)['"]/gi)].find(match=>match[2]===config.host);
  const known=String(source).match(/UserKnownHostsFile=.*?path\.join\(os\.homedir\(\),\s*['"]([^'"]+)['"]\)/s);
  const key=String(source).match(/['"]-i['"],\s*path\.join\(os\.homedir\(\),\s*['"]([^'"]+)['"]\)/);
  const command=String(source).match(/['"](\/[^'"\s]+\/node)\s+(\/[^'"\s]+serverFarmControl\.cjs)['"]/);
  if(!target||!known||!key||!command||!known[1].startsWith('.ssh/')||!key[1].startsWith('.ssh/'))continue;
  const profile=validateServerProfile({name:'Servidor existente',host:config.host,port:22,user:target[1],keyPath:path.join(home,key[1]),knownHostsPath:path.join(home,known[1]),nodePath:command[1],controlPath:command[2]});return {enabled:true,profile,transition:null,legacy:true};
 }
 throw Error('Não foi possível recuperar a ligação antiga. Configura o servidor existente; o farm local permanece bloqueado.');
}
module.exports={migrateLegacyFarmConfig};
