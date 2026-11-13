const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');
const login=require('../engine/accountLogin.cjs');
function page(path='/auth/login'){const fields=[{type:'email',value:'',dispatchEvent(){}},{type:'password',value:'',dispatchEvent(){}}];let submits=0;class Input{};Object.defineProperty(Input.prototype,'value',{set(value){this.value=value;}});return {fields,get submits(){return submits;},context:{location:{origin:'https://case-clicker.com',pathname:path},document:{querySelector:selector=>selector==='input[type="email"]'?fields[0]:selector==='input[type="password"]'?fields[1]:null,querySelectorAll:()=>fields,submit:()=>submits++},HTMLInputElement:Input,Event:class Event{}}};}
test('fills existing credentials on official login only and leaves submission to user',()=>{
 assert.equal(typeof login.loginFillScript,'function');const fixture=page();vm.runInNewContext(login.loginFillScript({email:'player@example.com',password:'test-only-secret'}),fixture.context);assert.equal(fixture.fields[0].value,'player@example.com');assert.equal(fixture.fields[1].value,'test-only-secret');assert.equal(fixture.submits,0);
});
test('never fills credentials on reset pages or another origin',()=>{
 assert.equal(typeof login.loginFillScript,'function');for(const path of ['/auth/reset-password','/auth/signup']){const fixture=page(path);assert.equal(vm.runInNewContext(login.loginFillScript({email:'test',password:'secret'}),fixture.context),false);assert.equal(fixture.fields[1].value,'');}
 const fixture=page();fixture.context.location.origin='https://other.example';assert.equal(vm.runInNewContext(login.loginFillScript({email:'test',password:'secret'}),fixture.context),false);
});
function autoPage({disabled=false,challenge='token',path='/auth/login',error=''}={}){
 let clicks=0;const form={dataset:{},querySelector:selector=>selector==='button[type="submit"]'?{disabled,click(){clicks++;}}:selector==='input[name="cf-turnstile-response"]'?{value:challenge}:null};
 const email={value:'player@example.com',closest:()=>form},password={value:'test-secret',closest:()=>form};
 return {get clicks(){return clicks;},context:{location:{origin:'https://case-clicker.com',pathname:path},document:{querySelector:s=>s==='input[type="email"]'?email:s==='input[type="password"]'?password:null,querySelectorAll:()=>error?[{textContent:error}]:[]}}};
}
test('automatic login submits the official enabled form only once',()=>{
 assert.equal(typeof login.loginStepScript,'function');const fixture=autoPage();assert.equal(vm.runInNewContext(login.loginStepScript(true),fixture.context),'submitted');assert.equal(vm.runInNewContext(login.loginStepScript(true),fixture.context),'waiting');assert.equal(fixture.clicks,1);
});
test('automatic login does not submit a CAPTCHA, a disabled button, an error or a reset form',()=>{
 assert.equal(typeof login.loginStepScript,'function');for(const options of [{challenge:''},{disabled:true},{path:'/auth/reset-password'},{error:'Incorrect password'}]){const fixture=autoPage(options);assert.notEqual(vm.runInNewContext(login.loginStepScript(true),fixture.context),'submitted');assert.equal(fixture.clicks,0);}
});
