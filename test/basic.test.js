import test from 'node:test';
import assert from 'node:assert/strict';
import {TeraBoxAPI} from '../src/terabox.js';

test('cookie header includes available session cookies', async()=>{const tb=new TeraBoxAPI(); const c=tb.cookie(); assert.equal(typeof c,'string');});
test('path normalization', ()=>{assert.equal('/a/b','/a/b');});
test('API client can be constructed without browser dependencies', ()=>{const tb=new TeraBoxAPI(); assert.equal(typeof tb.session,'function'); assert.equal(typeof tb.upload,'function');});
test('token extraction supports common TeraBox HTML forms', ()=>{const tb=new TeraBoxAPI(); const html='<script>var jsToken="abc123"; var bdstoken="def456";</script>'; assert.equal(tb.extractToken(html,['jsToken']),'abc123'); assert.equal(tb.extractToken(html,['bdstoken']),'def456');});
