import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));
const docker=fs.readFileSync("Dockerfile","utf8");
const config=fs.readFileSync("src/config.js","utf8");
const server=fs.readFileSync("src/server.js","utf8");
const env=fs.readFileSync(".env.example","utf8");

test("Playwright package and Docker image versions match",()=>{
  const version=pkg.dependencies.playwright;
  assert.match(version,/^1\.62\.1$/);
  assert.match(docker,new RegExp(`playwright:v${version.replaceAll(".","\\.")}-noble`));
});

test("current TeraBox login endpoint is configured",()=>{
  assert.ok(config.includes("https://www.terabox.com/login/loginsetting"));
  assert.ok(env.includes("TERABOX_LOGIN_URL=https://www.terabox.com/login/loginsetting"));
});

test("failed startup smoke does not advertise the service as ready",()=>{
  assert.match(server,/boot\.ready=!!boot\.smoke\.ok/);
});

test("credentials are supplied through environment variables",()=>{
  assert.match(config,/TERABOX_EMAIL/);
  assert.match(config,/TERABOX_PASSWORD/);
  assert.match(env,/TERABOX_EMAIL=/);
  assert.match(env,/TERABOX_PASSWORD=/);
});


test("Render uses liveness endpoint so long credentialed smoke tests do not fail deployment",()=>{
  const render=fs.readFileSync(path.join(".","render.yaml"),"utf8");
  assert.match(render,/healthCheckPath:\s*\/live/);
});

test("health exposes initialization phase and explicit null error",()=>{
  const server=fs.readFileSync(path.join(".","src/server.js"),"utf8");
  assert.match(server,/phase:boot\.phase/);
  assert.match(server,/error:boot\.error\?\.message\|\|null/);
});

test("startup initialization has a hard timeout",()=>{
  const server=fs.readFileSync(path.join(".","src/server.js"),"utf8");
  assert.match(server,/BOOT_TIMEOUT_MS/);
  assert.match(server,/Startup smoke test timed out/);
});
