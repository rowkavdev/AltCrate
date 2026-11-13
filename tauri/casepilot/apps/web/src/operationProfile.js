// Display labels in the editor never become configuration or transport fields.
export function toOperationProfileRules(rules){
 const allowed=['id','name','action','conditions','destinationAccountId','storageUnitId'];
 return rules.map(rule=>!rule||typeof rule!=='object'||Array.isArray(rule)?rule:Object.fromEntries(allowed.filter(key=>Object.hasOwn(rule,key)&&(rule.action==='storage'||!['destinationAccountId','storageUnitId'].includes(key))).map(key=>[key,structuredClone(rule[key])])));
}
