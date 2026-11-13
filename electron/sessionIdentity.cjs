// Identity is read only from a fresh token issued over the authenticated account session.
// The token itself never leaves this call or enters operation records.
function identityFromToken(body){
 const token=body?.token;if(typeof token!=='string'||token.length>16384)throw Error('Identidade da sessão indisponível');
 const parts=token.split('.');if(parts.length!==3)throw Error('Identidade da sessão indisponível');
 let claims;try{claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));}catch{throw Error('Identidade da sessão indisponível');}
 const ids=[claims?.id,claims?.sub].filter(value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value));
 if(!ids.length||new Set(ids).size!==1)throw Error('Identidade da sessão indisponível');return ids[0];
}
module.exports={identityFromToken};
