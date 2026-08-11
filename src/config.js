import path from 'node:path';

const int=(v,d)=>Number.isFinite(Number(v))?Number(v):d;
export const config={
 PORT:int(process.env.PORT,10000),
 API_KEY:process.env.API_KEY||'',
 NDUS:process.env.TERABOX_NDUS||'',
 JSTOKEN:process.env.TERABOX_JSTOKEN||'',
 APP_ID:process.env.TERABOX_APP_ID||'250528',
 BDSTOKEN:process.env.TERABOX_BDSTOKEN||'',
 BROWSER_ID:process.env.TERABOX_BROWSER_ID||'',
 BASE_URL:process.env.TERABOX_BASE_URL||'https://www.1024terabox.com',
 UPLOAD_URL:process.env.TERABOX_UPLOAD_URL||'https://c-jp.1024terabox.com',
 REQUEST_TIMEOUT_MS:int(process.env.REQUEST_TIMEOUT_MS,60000),
 UPLOAD_LIMIT_BYTES:int(process.env.UPLOAD_LIMIT_BYTES,10*1024*1024*1024),
 CHUNK_SIZE:int(process.env.CHUNK_SIZE,16*1024*1024)
};
export function requireSession(){
 if(!config.NDUS) throw Object.assign(new Error('TERABOX_NDUS is required. API-only mode uses an authenticated TeraBox web session; it does not automate login.'),{code:'SESSION_CONFIG_MISSING',status:503});
}
