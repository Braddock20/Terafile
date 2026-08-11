import {chromium} from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {config} from "./config.js";
import {logger} from "./logger.js";

const loginUrl=/\/login(?:\/|$)|loginsetting|outlogin|outside\/login/i;
const loginText=/\b(log\s*in|login|sign\s*in)\b/i;
const verificationText=/(security verification|safe verification|verify that you are human|captcha|slider verification|risk verification)/i;

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
   await this.page?.screenshot({path:path.join(dir,"last.png"),fullPage:true}).catch(()=>{});
   const html=await this.page?.content().catch(()=>'')||"";
   await fs.writeFile(path.join(dir,"last.html"),html).catch(()=>{});
   logger.warn({label,url:this.page?.url(),title:await this.page?.title().catch(()=>null)} ,"debug snapshot captured");
  }catch(e){logger.warn({err:e},"debug capture failed");}
 }
 async home(){
  await this.page.goto(config.baseUrl,{waitUntil:"domcontentloaded",timeout:config.REQUEST_TIMEOUT_MS});
  await this.page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});
  return {url:this.page.url(),title:await this.page.title()};
 }
 async pageLooksLikeLogin(){
  if(!this.page)return true;
  if(loginUrl.test(this.page.url()))return true;
  const password=await this.page.locator('input[type="password"]').first().isVisible().catch(()=>false);
  if(password)return true;
  const loginControls=await this.page.getByText(loginText,{exact:false}).first().isVisible().catch(()=>false);
  return loginControls && !await this.hasAuthenticatedUi();
 }
 async hasAuthenticatedUi(){
  const candidates=[
   'input[type="file"]',
   'button:has-text("Upload")',
   '[role="button"]:has-text("Upload")',
   'text=My Files',
   'text=All Files',
   'text=Recent'
  ];
  for(const selector of candidates){
   if(await this.page.locator(selector).first().isVisible().catch(()=>false))return true;
  }
  return false;
 }
 async loggedIn(){
  if(!this.page)return false;
  if(await this.pageLooksLikeLogin())return false;
  return await this.hasAuthenticatedUi();
 }
 async loginWithCredentials(){
  if(!config.TERABOX_EMAIL||!config.TERABOX_PASSWORD)
   throw Object.assign(new Error("TERABOX_EMAIL and TERABOX_PASSWORD are required for automatic Render login"),{code:"CONFIG_MISSING"});

  await this.page.goto(config.TERABOX_LOGIN_URL,{waitUntil:"domcontentloaded",timeout:config.REQUEST_TIMEOUT_MS});
  await this.page.waitForLoadState("networkidle",{timeout:12000}).catch(()=>{});

  // Current TeraBox web login exposes an email/password form on /login/loginsetting.
  // Keep selectors broad because the site localizes labels across regions.
  const email=this.page.locator('input[type="email"],input[placeholder*="email" i],input[placeholder*="邮箱" i]').first();
  const password=this.page.locator('input[type="password"],input[placeholder*="password" i],input[placeholder*="密码" i]').first();
  try{
   await email.waitFor({state:"visible",timeout:15000});
   await password.waitFor({state:"visible",timeout:10000});
  }catch(e){
   await this.captureDebug("login_form_not_found");
   throw Object.assign(new Error("TeraBox email/password form was not found. The site may have changed the login flow."),{code:"LOGIN_FORM_NOT_FOUND",cause:e.message});
  }

  await email.fill(config.TERABOX_EMAIL);
  await password.fill(config.TERABOX_PASSWORD);

  const submit=this.page.locator('button[type="submit"],button:has-text("Login"),button:has-text("Log in"),button:has-text("Sign in"),button:has-text("登录"),button:has-text("Masuk")').first();
  if(!(await submit.isVisible().catch(()=>false))){
   await this.captureDebug("login_submit_not_found");
   throw Object.assign(new Error("TeraBox login submit control was not found."),{code:"LOGIN_SUBMIT_NOT_FOUND"});
  }

  await Promise.allSettled([
   this.page.waitForLoadState("domcontentloaded",{timeout:20000}),
   submit.click()
  ]);
  await this.page.waitForTimeout(3000);

  const body=await this.page.locator("body").innerText().catch(()=>"");
  if(verificationText.test(body)){
   await this.captureDebug("security_verification_required");
   throw Object.assign(new Error("TeraBox requires an interactive security verification/CAPTCHA. Automatic login will not bypass it."),{code:"SECURITY_VERIFICATION_REQUIRED"});
  }
  if(!(await this.loggedIn())){
   await this.captureDebug("login_incomplete");
   throw Object.assign(new Error("TeraBox did not complete automatic login. Check the credentials or the current login flow."),{code:"LOGIN_INCOMPLETE"});
  }
  await this.saveState();
  return true;
 }
 async saveState(){
  const state=await this.browser.storageState();
  await fs.mkdir(path.dirname(config.stateFile),{recursive:true});
  await fs.writeFile(config.stateFile,JSON.stringify(state,null,2),{mode:0o600});
 }
 async ensureAuth(){
  await this.home();
  if(await this.loggedIn())return true;
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
    const button=this.page.locator('button:has-text("Upload"),[role="button"]:has-text("Upload")').first();
    if(!(await button.isVisible().catch(()=>false))){
     await this.captureDebug("upload_control_missing");
     throw Object.assign(new Error("TeraBox upload control not found; UI changed or the account is not authenticated."),{code:"UPLOAD_CONTROL_NOT_FOUND"});
    }
    const chooser=this.page.waitForEvent("filechooser",{timeout:10000});
    await button.click();
    await (await chooser).setFiles(localPath);
   }
   await this.page.getByText(name,{exact:false}).first().waitFor({state:"visible",timeout:Math.max(60000,config.REQUEST_TIMEOUT_MS)}).catch(()=>{});
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
   const authenticated=await this.ensureAuth();
   const upload=await this.upload(smokeFile,"/");
   return {ok:publicPage&&authenticated&&!!upload.uploaded,publicPage,authenticated,upload,durationMs:Date.now()-started};
  }catch(e){
   return {ok:false,publicPage,authenticated:false,error:e.message,code:e.code,durationMs:Date.now()-started};
  }finally{await fs.unlink(smokeFile).catch(()=>{});}
 }
}
