function openingTypeForCatalog(caseId,catalog){
 const item=catalog.find(value=>value.id===caseId);
 if(!item)throw Error('O item selecionado não consta do catálogo');
 if(item.category==='cases')return 'case';
 if(item.category==='capsules')return 'capsule';
 throw Error('A abertura deste tipo ainda não está disponível');
}
function openingRunSettings(config,accounts,itemRules=[]){
 const containerType=config.containerType??'case';
 if(!['case','capsule'].includes(containerType))throw Error('Tipo de abertura inválido');
 if(containerType==='capsule'&&config.convert===true)throw Error('A conversão por preço está disponível apenas para caixas');
 const testOnce=config.testOnce===true;
 if(testOnce&&accounts.length!==1)throw Error('Seleciona uma conta para abrir uma caixa');
 return {
  accounts,caseId:config.caseId,containerType,continuous:!testOnce,maxOpens:testOnce?1:undefined,adaptive:true,testOnce,
  maxCasesPerAccount:testOnce?1:config.maxCasesPerAccount,
  concurrency:Math.min(accounts.length,20),convert:config.convert===true,conversionMode:config.conversionMode,
  maxPrice:Number(config.maxPrice),conversionCap:testOnce?1:null,itemRules,
 };
}
module.exports={openingRunSettings,openingTypeForCatalog};
