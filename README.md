# TeraBox API-only Render adapter v2.1

No Playwright or Chromium. Uses the authenticated TeraBox web session over HTTP.

## Render environment

Required:
- `TERABOX_NDUS`
- `TERABOX_CSRFTOKEN` (recommended)
- `TERABOX_BROWSER_ID` (recommended)
- `API_KEY`

Optional:
- `TERABOX_JSTOKEN`
- `TERABOX_BDSTOKEN`

The client first requests `/main` and attempts to derive `jsToken`/`bdstoken` from the returned page. If the deployment requires explicit values, set them as secrets. No token is returned by `/debug/auth`.

## Endpoints

- `GET /health`
- `GET /live`
- `GET /debug/auth`
- `GET /session`
- `GET /files?dir=/`
- `POST /folders` `{ "path": "/Folder" }`
- `POST /upload` multipart field `file`, optional `folder`
- `GET /download/:fsId`
- `POST /delete` `{ "files": [...] }`
- `POST /move` `{ "files": [...] }`

Set `X-API-Key` when `API_KEY` is configured.

### Security
Never commit session cookies or tokens. Treat `ndus` and related session material as credentials and rotate them if exposed.

### Testing
`npm test`
`npm run lint`
