import express from 'express';
import multer from 'multer';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import {config} from './config.js';
import {TeraBoxAPI} from './terabox.js';

const VERSION='2026-08-11-api-only-v2.1'; const logger=pino(); const app=express(); const tb=new TeraBoxAPI();
app.disable('x-powered-by'); app.set('trust proxy',true); app.use(express.json({limit:'2mb'})); app.use(pinoHttp({logger}));
const upload=multer({dest:'/tmp/terabox-api',limits:{fileSize:config.UPLOAD_LIMIT_BYTES}});
let ready=false; let startup={ok:false,phase:'starting',error:null};
function auth(req,res,next){if(!config.API_KEY)return next(); const got=req.get('x-api-key')||req.get('authorization')?.replace(/^Bearer\s+/i,''); if(!got||got.length!==config.API_KEY.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(config.API_KEY)))return res.status(401).json({ok:false,error:'Unauthorized'}); next();}
function safeError(e){return {ok:false,error:e.message,code:e.code,status:e.upstreamStatus,data:e.data};}
app.get('/',(_,res)=>res.json({service:'terabox-api-render',version:VERSION,mode:'api-only',endpoints:['/health','/live','/debug/auth','/session','/files','/folders','/upload','/download/:fsId','/delete','/move']}));
app.get('/live',(_,res)=>res.json({ok:true,service:'terabox-api-render',version:VERSION,phase:startup.phase}));
app.get('/health',(_,res)=>res.status(ready?200:503).json({ok:ready,service:'terabox-api-render',version:VERSION,mode:'api-only',startup}));
app.use(auth);
app.get('/debug/auth',async(_,res)=>{try{const r=await tb.session(); res.json({ok:true,version:VERSION,authenticated:true,credentials:r.credentials})}catch(e){res.status(e.status||502).json({...safeError(e),version:VERSION,authenticated:false})}});
app.get('/session',async(_,res)=>{try{res.json(await tb.session())}catch(e){res.status(e.status||502).json(safeError(e))}});
app.get('/files',async(req,res)=>{try{res.json({ok:true,...await tb.list(req.query.dir||'/',Number(req.query.page||1),Math.min(Number(req.query.num||100),1000))})}catch(e){res.status(e.status||502).json(safeError(e))}});
app.post('/folders',async(req,res)=>{try{res.status(201).json({ok:true,...await tb.createDirectory(req.body.path)})}catch(e){res.status(e.status||502).json(safeError(e))}});
app.post('/upload',upload.single('file'),async(req,res)=>{if(!req.file)return res.status(400).json({ok:false,error:"multipart field 'file' is required"}); try{const result=await tb.upload(req.file.path,req.body.folder||'/');res.status(201).json({ok:true,...result})}catch(e){res.status(e.status||502).json(safeError(e))}finally{await fsp.unlink(req.file.path).catch(()=>{})}});
app.get('/download/:fsId',async(req,res)=>{try{res.json({ok:true,...await tb.downloadLink(req.params.fsId)})}catch(e){res.status(e.status||502).json(safeError(e))}});
app.post('/delete',async(req,res)=>{try{res.json({ok:true,...await tb.delete(req.body.files||[])})}catch(e){res.status(e.status||502).json(safeError(e))}});
app.post('/move',async(req,res)=>{try{res.json({ok:true,...await tb.move(req.body.files||[])})}catch(e){res.status(e.status||502).json(safeError(e))}});
app.use((e,_,res,__)=>(res.status(500).json({ok:false,error:e.message||'Internal error'})));
const server=app.listen(config.PORT,'0.0.0.0',async()=>{startup.phase='checking_session'; try{await tb.session(); ready=true; startup={ok:true,phase:'ready',error:null}; logger.info('TeraBox API session verified')}catch(e){startup={ok:false,phase:'session_required',error:{message:e.message,code:e.code,status:e.status}}; logger.warn({err:e},'API service started without verified TeraBox session')}});
process.on('SIGTERM',()=>server.close()); process.on('SIGINT',()=>server.close());
export {app,server};
