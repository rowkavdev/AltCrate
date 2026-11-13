function createOperationInterlock(guard) {
  let pending=0;
  return {busy:()=>pending>0,async run(work){guard();pending++;try{return await work();}finally{pending--;}}};
}
module.exports={createOperationInterlock};
