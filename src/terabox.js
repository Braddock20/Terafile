import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {config,requireSession} from './config.js';

const jsonHeaders={'Accept':'application/json, text/plain, */*'};
const cleanPath=(p)=>{p=String(p||'/'); if(!p.startsWith('/'))p='/'+p; return p.replace(/\/+/g,'/');};
const cookie=()=>['ndus='+config.NDUS,config.BROWSER_ID&&'browserid='+config.BROWSER_ID].filter(Boolean).join('; ');
const dpLogId=()=>crypto.randomBytes(10).toString('hex').toUpperCase();

export class TeraBoxAPI{
 constructor({fetchImpl=globalThis.fetch}={}){this.fetch=fetchImpl;this.dpLogId=dpLogId();}
 url(endpoint,params={}){const u=new URL(endpoint,config.BASE_URL); for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v)); return u;}
 async request(url,options={},timeout=config.REQUEST_TIMEOUT_MS){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const r=await this.fetch(url,{...options,signal:controller.signal,headers:{...jsonHeaders,Cookie:cookie(),...(options.headers||{})}});
   const text=await r.text(); let data; try{data=JSON.parse(text);}catch{data=text;}
   if(!r.ok) throw Object.assign(new Error(`TeraBox HTTP ${r.status}`),{status:502,upstreamStatus:r.status,data});
   if(data&&typeof data==='object'&&Number(data.errno||0)!==0) throw Object.assign(new Error(data.errmsg||data.error_msg||`TeraBox errno ${data.errno}`),{status:502,code:`TB_${data.errno}`,data});
   return data;
  }catch(e){if(e.name==='AbortError')throw Object.assign(new Error('TeraBox request timed out'),{code:'UPSTREAM_TIMEOUT',status:504}); throw e;}
  finally{clearTimeout(timer);}
 }
 params(extra={}){return {app_id:config.APP_ID,web:1,channel:'dubox',clienttype:0,jsToken:config.JSTOKEN,'dp-logid':this.dpLogId,...extra};}
 async session(){requireSession(); const data=await this.request(this.url('/api/check/login',this.params())); return {ok:true,data};}
 async list(dir='/',page=1,num=100){requireSession(); return this.request(this.url('/api/list',this.params({order:'time',desc:1,dir:cleanPath(dir),num,page,showempty:0})));}
 async createDirectory(dir){requireSession(); const body=new URLSearchParams({path:cleanPath(dir),isdir:'1',size:'0',block_list:'[]',local_mtime:String(Math.floor(Date.now()/1000))}); if(config.BDSTOKEN)body.set('bdstoken',config.BDSTOKEN); return this.request(this.url('/api/create',this.params()),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});}
 async precreate(remote,size,blocks){const body=new URLSearchParams({path:cleanPath(remote),autoinit:'1',target_path:path.posix.dirname(cleanPath(remote)),block_list:JSON.stringify(blocks),size:String(size),local_mtime:String(Math.floor(Date.now()/1000))}); return this.request(this.url('/api/precreate',this.params()),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});}
 async uploadPart(remote,uploadid,partseq,buf){const u=this.url('/rest/2.0/pcs/superfile2',{method:'upload',app_id:config.APP_ID,channel:'dubox',clienttype:0,web:1,path:cleanPath(remote),uploadid,uploadsign:0,partseq}); const form=new FormData(); form.append('file',new Blob([buf])); return this.request(u,{method:'POST',headers:{Cookie:cookie()},body:form});}
 async create(remote,size,uploadid,blocks,rtype=1){const body=new URLSearchParams({path:cleanPath(remote),size:String(size),uploadid,block_list:JSON.stringify(blocks),local_mtime:String(Math.floor(Date.now()/1000)),isdir:'0',rtype:String(rtype)}); if(config.BDSTOKEN)body.set('bdstoken',config.BDSTOKEN); return this.request(this.url('/api/create',this.params()),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});}
 async upload(local,remoteDir='/',{onProgress}={}){
  requireSession(); const st=await fsp.stat(local); if(!st.isFile())throw Object.assign(new Error('Upload source must be a file'),{status:400});
  const name=path.basename(local), remote=cleanPath(path.posix.join(remoteDir,name)); const size=st.size; const chunks=[];
  const fd=await fsp.open(local,'r'); try{let pos=0; while(pos<size){const n=Math.min(config.CHUNK_SIZE,size-pos); const b=Buffer.alloc(n); await fd.read(b,0,n,pos); chunks.push(crypto.createHash('md5').update(b).digest('hex')); pos+=n;}} finally{await fd.close();}
  const pre=await this.precreate(remote,size,chunks); if(pre.return_type===2)return {uploaded:true,existing:true,remote,precreate:pre};
  const needed=Array.isArray(pre.block_list)&&pre.block_list.length?pre.block_list:chunks.map((_,i)=>i); const uploaded=[]; const fd2=await fsp.open(local,'r'); try{for(const i of needed){const start=i*config.CHUNK_SIZE; const n=Math.min(config.CHUNK_SIZE,size-start); const b=Buffer.alloc(n); await fd2.read(b,0,n,start); const r=await this.uploadPart(remote,pre.uploadid,i,b); uploaded.push(r?.md5||chunks[i]); onProgress?.({loaded:Math.min(start+n,size),total:size,part:i,parts:chunks.length});}} finally{await fd2.close();}
  const created=await this.create(remote,size,pre.uploadid,chunks,1); return {uploaded:true,existing:false,remote,uploadid:pre.uploadid,parts:uploaded.length,create:created};
 }
 async downloadLink(fsId){requireSession(); const home=await this.request(this.url('/api/home/info',{app_id:config.APP_ID,web:1,channel:'dubox',clienttype:0})); const d=home?.data||{}; if(!d.sign1||!d.sign3||!d.timestamp)throw Object.assign(new Error('TeraBox home info did not provide download signing data'),{code:'DOWNLOAD_SIGN_DATA_MISSING',status:502}); const sign=this.sign(d.sign3,d.sign1); return this.request(this.url('/api/download',this.params({fidlist:`[${fsId}]`,type:'dlink',vip:2,sign,timestamp:d.timestamp,need_speed:0}))); }
 sign(s1,s2){const p=new Uint8Array(256),a=new Uint8Array(256);let j=0;for(let i=0;i<256;i++){a[i]=s1.charCodeAt(i%s1.length);p[i]=i;}for(let i=0;i<256;i++){j=(j+p[i]+a[i])%256;[p[i],p[j]]=[p[j],p[i]];}let i=0; j=0; const out=[];for(const ch of s2){i=(i+1)%256;j=(j+p[i])%256;[p[i],p[j]]=[p[j],p[i]];out.push(ch.charCodeAt(0)^p[(p[i]+p[j])%256]);}return Buffer.from(out).toString('base64');}
 async fileManager(op,filelist){requireSession(); const body=new URLSearchParams({filelist:JSON.stringify(filelist)}); return this.request(this.url('/api/filemanager',this.params({opera:op})),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});}
 async delete(filelist){return this.fileManager('delete',filelist);}
 async move(filelist){return this.fileManager('move',filelist);}
}
