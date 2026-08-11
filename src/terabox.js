import {chromium} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {config} from "./config.js";
import {logger} from "./logger.js";

const loginUrl=/\/login(?:\/|$)|loginsetting|outlogin/i;
const uploadSelectors=[
 'input[type="file"]',
 'button:has-text("Upload")',
 '[role="button"]:has-text("Upload")',
 'text=Upload'
];

const cleanName=n=>path.basename(String(n)).replace(/[^\w.\- ()[\]]+/g,"_").slice(0,180)||"upload.bin";

export class TeraBox{
 constructor(){this.browser=null;this.page=null;this.lock=Promise.resolve();this.state="created";this.lastError=null;}
 async init(){
  this.browser=await chromium.launchPersistentContext(config.profileDir,{
   headless:config.HEADLESS,
   acceptDownloads:true,
   downloadsPath:config.downloadDir,
   viewport:{width:412,height:915},
   userAgent:"Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
   isMobile:true,
   hasTouch:true,
   locale:"en-US",
   timezoneId:"Africa/Nairobi",
   args:["--disable-dev-shm-usage","--no-sandbox"]
  });
  this.page=this.browser.pages()[0]||await this.browser.newPage();
  this.page.setDefaultTimeout(config.REQUEST_TIMEOUT_MS);
  this.browser.on("page",p=>{p.setDefaultTimeout(config.REQUEST_TIMEOUT_MS);this.page=p;});
  this.state="browser_ready";
 }
 async close(){await this.browser?.close().catch(()=>{});this.browser=null;this.page=null;this.state="closed";}
 async captureDebug(label="failure"){
  try{
   const dir=path.join(config.tmpDir,"debug");
   await fs.mkdir(dir,{recursive:true});
   await this.page.screenshot({path:path.join(dir,"last.png"),fullPage:true}).catch(()=>{});
   const html=await this.page.content().catch(()=>"");
   await fs.writeFile(path.join(dir,"last.html"),html).catch(()=>{});
   logger.warn({label,url:this.page.url(),title:await this.page.title().catch(()=>null)},"debug snapshot captured");
  }catch(e){logger.warn({err:e},"debug capture failed");}
 }
 async home(){
  await this.page.goto(config.baseUrl,{waitUntil:"domcontentloaded",timeout:config.REQUEST_TIMEOUT_MS});
  await this.page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  return {url:this.page.url(),title:await this.page.title()};
 }
 async loggedIn(){
  if(!this.page)return false;
  if(loginUrl.test(this.page.url()))return false;
  const password=await this.page.locator('input[type="password"]').first().isVisible().catch(()=>false);
  if(password)return false;
  const loginButton=await this.page.locator('a:has-text("Login"),button:has-text("Login")').first().isVisible().catch(()=>false);
  if(loginButton)return false;
  return true;
 }
 async loginWithCredentials(){
  if(!config.TERABOX_EMAIL||!config.TERABOX_PASSWORD)
   throw new Error("TERABOX_EMAIL and TERABOX_PASSWORD are required for automatic Render login");
  await this.page.goto(config.TERABOX_LOGIN_URL,{waitUntil:"domcontentloaded",timeout:config.REQUEST_TIMEOUT_MS});
  const email=this.page.locator('input[type="email"],input[placeholder*="email" i]').first();
  const password=this.page.locator('input[type="password"],input[placeholder*="password" i]').first();
  try{
   await email.waitFor({state:"visible",timeout:15000});
  }catch(e){
   await this.captureDebug("login_form_not_found");
   throw e;
  }
  await email.fill(config.TERABOX_EMAIL);
  await password.fill(config.TERABOX_PASSWORD);
  const submit=this.page.locator('button:has-text("Login"),button:has-text("Log in"),button[type="submit"],text=Login').first();
  await submit.click();
  await this.page.waitForLoadState("networkidle",{timeout:20000}).catch(()=>{});
  await this.page.waitForTimeout(2500);
  if(!(await this.loggedIn())){
   await this.captureDebug("login_incomplete");
   throw Object.assign(new Error("TeraBox did not complete automatic login. It may require security verification/CAPTCHA or a different login method."),{code:"LOGIN_INCOMPLETE"});
  }
  await this.saveState();
  return true;
 }
 async saveState(){
  const state=await this.browser.storageState();
  await fs.writeFile(config.stateFile,JSON.stringify(state,null,2),{mode:0o600});
 }
 async ensureAuth(){
  await this.page.goto(config.TERABOX_LOGIN_URL,{waitUntil:"domcontentloaded",timeout:config.REQUEST_TIMEOUT_MS});
  await this.page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  const email=this.page.locator('input[type="email"],input[placeholder*="email" i]').first();
  const onLoginForm=await email.isVisible().catch(()=>false);
  if(!onLoginForm){
   await this.captureDebug("assumed_authenticated");
   await this.saveState();
   return true;
  }
  if(config.AUTO_LOGIN){await this.loginWithCredentials();return true;}
  throw Object.assign(new Error("Not authenticated"),{code:"AUTH_REQUIRED",status:401});
 }
 async upload(localPath,folder="/"){
  const previous=this.lock;let release;this.lock=new Promise(r=>release=r);await previous;
  try{
   await this.ensureAuth();
   const name=cleanName(path.basename(localPath));
   const input=this.page.locator('input[type="file"]').first();
   if(await input.count()) await input.setInputFiles(localPath);
   else{
    const button=this.page.locator(uploadSelectors.slice(1).join(",")).first();
    if(!(await button.isVisible().catch(()=>false))){
     await this.captureDebug("upload_control_missing");
     throw new Error("TeraBox upload control not found; UI changed");
    }
    const chooser=this.page.waitForEvent("filechooser",{timeout:10000});
    await button.click();await (await chooser).setFiles(localPath);
   }
   await this.page.getByText(name,{exact:false}).first()
    .waitFor({state:"visible",timeout:Math.max(60000,config.REQUEST_TIMEOUT_MS)}).catch(()=>{});
   return {name,folder,uploaded:true,url:this.page.url()};
  }finally{release();}
 }
 async smoke(){
  const started=Date.now();
  const home=await this.home();
  const publicPage=!!home.title;
  const smokeFile=path.join(config.tmpDir,`.terabox-smoke-${Date.now()}.txt`);
  await fs.writeFile(smokeFile,"TeraBox Playwright smoke test");
  try{
   const upload=await this.upload(smokeFile,"/");
   return {ok:publicPage&&!!upload,publicPage,authenticated:true,upload,durationMs:Date.now()-started};
  }catch(e){
   const authenticated=!["AUTH_REQUIRED","LOGIN_INCOMPLETE"].includes(e.code);
   return {ok:false,publicPage,authenticated,error:e.message,code:e.code,durationMs:Date.now()-started};
  }finally{await fs.unlink(smokeFile).catch(()=>{});}
 }
}

