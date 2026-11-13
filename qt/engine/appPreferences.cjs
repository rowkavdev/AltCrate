function createAppPreferences({load,save}) {
 let value={enableSiteOpening:false},tail=Promise.resolve();
 return {
  async ready(){const stored=await load();value={enableSiteOpening:stored?.enableSiteOpening===true};return this.read();},
  read:()=>({...value}),
  update(patch){
   if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).length!==1||!Object.hasOwn(patch,'enableSiteOpening')||typeof patch.enableSiteOpening!=='boolean')return Promise.reject(Error('Preferência inválida'));
   const next={enableSiteOpening:patch.enableSiteOpening};
   const task=tail.catch(()=>{}).then(async()=>{await save({...next});value=next;return {...value};});tail=task;return task;
  },
 };
}
module.exports={createAppPreferences};
