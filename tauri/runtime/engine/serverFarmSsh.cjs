const {spawn}=require('node:child_process');const {sshArguments,sshProgram}=require('./serverFarmProfile.cjs');
function createServerSsh({profile,spawnProcess=spawn}={}){
 return request=>new Promise((resolve,reject)=>{
  if(!profile)return reject(Error('Configura o teu servidor antes de ligar'));let args;try{args=sshArguments(profile);}catch(error){return reject(error);}
  const child=spawnProcess(sshProgram(),args,{stdio:['pipe','pipe','pipe']});let output='',stderr='',settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('Ligação ao servidor sem resposta'));},100000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>16*1024*1024){child.kill();finish(Error('Resposta do servidor demasiado grande'));}});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
  child.on('error',()=>finish(Error('Não foi possível ligar ao servidor')));child.on('close',code=>{if(code!==0){const message=/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(stderr)?'A identidade SSH do servidor mudou. Verifica-a antes de continuar.':/Host key verification failed/i.test(stderr)?'Confirma a identidade SSH deste servidor antes de testar a ligação.':/Permission denied/i.test(stderr)?'A chave SSH não foi aceite para este utilizador. Escolhe a chave privada correta.':'Ligação SSH indisponível. Verifica o endereço, a porta e o acesso ao servidor.';return finish(Error(message));}try{const reply=JSON.parse(output);if(reply.error)finish(Error(reply.error));else finish(null,reply);}catch{finish(Error('Resposta inválida do servidor'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request)+'\n');
 });
}
module.exports={createServerSsh};
