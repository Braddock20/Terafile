# TeraBox API-only Render adapter

This version contains **no Playwright, Chromium, browser automation, or UI selectors**.

It talks directly to the authenticated TeraBox web API flow used by third-party clients. Public reverse-engineered implementations document the `ndus` session cookie, `jsToken`, app id, precreate, shard upload, create, list, file-manager, and download flows. The TeraBox Open Platform documents a similar precreate/shard/create sequence, but this project intentionally uses the web-session API rather than the official Open Platform.

## Important authentication change

Email/password are **not used by this API-only service**. The web API flow requires an authenticated session, represented here by `TERABOX_NDUS` and `TERABOX_JSTOKEN` (and optionally browser id/bdstoken). Do not paste your TeraBox password into this project.

Obtain the values from your own authenticated TeraBox session and store them as Render secret environment variables. Do not commit them.

## Render variables

```text
API_KEY=<your API key>
TERABOX_NDUS=<session cookie value>
TERABOX_JSTOKEN=<jsToken>
TERABOX_APP_ID=250528
TERABOX_BDSTOKEN=<optional>
TERABOX_BROWSER_ID=<optional>
```

## API

```text
GET  /health
GET  /live
GET  /session
GET  /files?dir=/&page=1&num=100
POST /folders              {"path":"/Test"}
POST /upload               multipart: file + folder
GET  /download/:fsId
POST /delete               {"files":[...]}
POST /move                 {"files":[...]}
```

Authentication is via `x-api-key` or `Authorization: Bearer ...` when `API_KEY` is set.

## Upload

The adapter calculates MD5 for each chunk, calls precreate, uploads only the chunks requested by TeraBox, then calls create. Default chunk size is 16 MiB. The service streams the local upload into memory one chunk at a time rather than loading the entire file.

## Tests

```bash
npm install
npm test
npm run lint
```

A live authenticated test requires your current TeraBox session values and network access, so the package does not pretend that a local mock test is a real-account test.
