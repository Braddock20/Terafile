import test from 'node:test'; import assert from 'node:assert/strict';
import {TeraBoxAPI} from '../src/terabox.js'; import {config} from '../src/config.js';

test('sign algorithm is deterministic',()=>{const t=new TeraBoxAPI(); assert.equal(t.sign('abc','hello'),'pfi1RTc=');});
test('list builds legacy API request',async()=>{let seen; const t=new TeraBoxAPI({fetchImpl:async(url)=>{seen=new URL(url); return new Response(JSON.stringify({errno:0,list:[]}))}}); config.NDUS='x'; config.JSTOKEN='y'; const r=await t.list('/'); assert.equal(r.errno,0); assert.equal(seen.pathname,'/api/list'); assert.equal(seen.searchParams.get('app_id'),'250528');});
test('precreate request is form encoded',async()=>{let seen; const t=new TeraBoxAPI({fetchImpl:async(url,opts)=>{seen={url:new URL(url),opts}; return new Response(JSON.stringify({errno:0,uploadid:'u',block_list:[0]}))}}); config.NDUS='x'; config.JSTOKEN='y'; const r=await t.precreate('/a.txt',3,['abc']); assert.equal(r.uploadid,'u'); assert.equal(seen.opts.method,'POST'); assert.match(seen.opts.headers['Content-Type'],/x-www-form-urlencoded/);});
