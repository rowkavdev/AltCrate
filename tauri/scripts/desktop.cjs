const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'../..'),environment={...process.env};
const cargo=path.join(root,'.toolchains/cargo'),rustup=path.join(root,'.toolchains/rustup');
if(fs.existsSync(path.join(cargo,'bin/cargo'))){environment.CARGO_HOME=cargo;environment.RUSTUP_HOME=rustup;environment.PATH=path.join(cargo,'bin')+path.delimiter+environment.PATH;}
const args=process.argv.slice(2);const mode=args.shift()||'dev';
const output=path.join(root,'release-tauri/mac-arm64/CasePilot.app');
if(mode==='start'){
 if(!fs.existsSync(output)){console.error('Compila primeiro a aplicação com npm run build.');process.exit(1);}
 const result=spawnSync('/usr/bin/open',[output],{stdio:'inherit'});process.exit(result.status??1);
}
if(mode==='dev'||mode==='build'){
 const target={
  'darwin:arm64':'aarch64-apple-darwin',
  'linux:x64':'x86_64-unknown-linux-gnu',
 }[process.platform+':'+process.arch];
 if(!target){console.error('Usa Node.js arm64 no macOS ou Node.js x64 no Linux.');process.exit(1);}
 const sidecar=path.join(root,'tauri/casepilot/src-tauri/binaries/casepilot-node-'+target);
 fs.mkdirSync(path.dirname(sidecar),{recursive:true});
 fs.copyFileSync(process.execPath,sidecar);
 fs.chmodSync(sidecar,0o755);
}
const child=spawn('pnpm',['exec','tauri',mode,...args],{cwd:path.join(root,'tauri/casepilot'),env:environment,stdio:'inherit'});
child.on('exit',code=>{
 if(code!==0){process.exit(code??1);return;}
 if(mode==='build'&&process.platform==='darwin'){
  const source=path.join(root,'tauri/casepilot/src-tauri/target/release/bundle/macos/CasePilot.app');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  const browser=path.join(root,'node_modules/electron/dist/Electron.app');
  if(!fs.existsSync(browser)){console.error('Falta o navegador Chromium local. Instala as dependências do projeto.');process.exit(1);}
  for(const [command,values] of [['/usr/bin/ditto',[source,output]],['/usr/bin/ditto',[browser,path.join(output,'Contents/Resources/runtime/chromium/Electron.app')]],['/usr/bin/codesign',['--force','--deep','--sign','-',output]],['/usr/bin/codesign',['--verify','--deep','--strict',output]]]){
   const result=spawnSync(command,values,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
  }
  console.log('Aplicação Tauri: '+output);
 }
 process.exit(0);
});
child.on('error',()=>{console.error('Não foi possível iniciar o gestor de pacotes pnpm.');process.exit(1);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
