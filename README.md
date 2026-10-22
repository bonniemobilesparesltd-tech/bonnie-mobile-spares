# Bonnie Mobile Spares — Five-Branch Booking MVP

A lightweight booking/enquiry website for Cloudflare Pages with a Cloudflare Worker API, Google Sheets storage, and WhatsApp Cloud API alerts to the selected branch manager and central management.

## What is included

- `public/`: mobile-friendly one-page booking form
- `worker.js`: API for listing branches, validating submissions, appending to Google Sheets, and sending WhatsApp template notifications
- `wrangler.toml`: Worker configuration starter

## Important before launch

This is a starter implementation. It is not live until you configure actual branch names, phone numbers, Google service account credentials, the target spreadsheet, and an approved WhatsApp template. Never put tokens/private keys in `public/`, frontend JavaScript, or a public Git repository.

## 1. Create the Google Sheet

1. Create a Google spreadsheet.
2. Name the first tab `Bookings`.
3. Add this header row in row 1, columns A–K:

`Created At | Reference | Branch | Customer Name | Customer Phone | Service | Details | Preferred Contact | Status | Branch WhatsApp Status | Central WhatsApp Status`

4. Copy the spreadsheet ID from its URL. It is the part between `/d/` and `/edit`.

## 2. Create a Google service account

1. In Google Cloud Console, create/select a project.
2. Enable the Google Sheets API.
3. Create a service account and a JSON key.
4. Share the target spreadsheet with the service account email as **Editor**.
5. Keep the downloaded JSON key private. The `client_email` is `GOOGLE_SERVICE_ACCOUNT_EMAIL`; `private_key` is `GOOGLE_PRIVATE_KEY`.

## 3. Configure WhatsApp Cloud API

1. In Meta for Developers, create/configure a Meta app and add WhatsApp.
2. Obtain a WhatsApp Business phone number ID and access token.
3. Create and get approval for a WhatsApp message template named `new_booking_alert` in language `en`.
4. Template body must contain six text placeholders, in this order:
   - `{{1}}` booking reference
   - `{{2}}` branch name
   - `{{3}}` customer name
   - `{{4}}` customer phone
   - `{{5}}` service
   - `{{6}}` enquiry details

Example template body:

`New Bonnie Mobile Spares enquiry {{1}}. Branch: {{2}}. Customer: {{3}}. Phone: {{4}}. Service: {{5}}. Details: {{6}}. Please follow up.`

Meta template requirements and business-initiated messaging rules apply. Use an approved template. Customer WhatsApp consent and applicable privacy/communications laws must be respected.

## 4. Configure Worker secrets and variables

Install Node.js and Wrangler if deploying via CLI. In this project directory:

```bash
npm install -g wrangler
wrangler login
```

Set secrets interactively (do not paste values into a source file):

```bash
wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
wrangler secret put GOOGLE_PRIVATE_KEY
wrangler secret put GOOGLE_SHEET_ID
wrangler secret put WHATSAPP_PHONE_NUMBER_ID
wrangler secret put WHATSAPP_ACCESS_TOKEN
wrangler secret put CENTRAL_WHATSAPP_NUMBER
```

Phone numbers should use international format without `+` for the Cloud API, e.g. Kenyan `2547...`; use the real number that is configured/allowed for the business. Do not use this example as an actual destination.

The `BRANCHES_JSON` in `wrangler.toml` is preconfigured with the five supplied branch names and normalized Kenya WhatsApp numbers. Numbers must use international digits only (for example `2547XXXXXXXX`), not the local leading `0`. The branch API returns each branch name and number so the form can show a direct `wa.me` chat link for the selected branch. Keep this config free of access tokens. Current shape:

```json
[
  {"name":"Exact Branch Name 1","whatsapp":"2547XXXXXXXX"},
  {"name":"Exact Branch Name 2","whatsapp":"2547XXXXXXXX"},
  {"name":"Exact Branch Name 3","whatsapp":"2547XXXXXXXX"},
  {"name":"Exact Branch Name 4","whatsapp":"2547XXXXXXXX"},
  {"name":"Exact Branch Name 5","whatsapp":"2547XXXXXXXX"}
]
```

Set central management to the supplied number in international digits: `254702432508`. Since this is the same number as Githurai, central and Githurai alerts currently reach the same WhatsApp account. Deploy:

```bash
wrangler deploy
```

Copy the deployed Worker URL, e.g. `https://bonnie-mobile-spares-api.<your-subdomain>.workers.dev`.

## 5. Deploy the Worker API

From the project root, install Wrangler and sign in:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
```

Copy the deployed Worker origin, for example `https://bonnie-mobile-spares-api.<your-subdomain>.workers.dev`.

## 6. Deploy the website to Cloudflare Pages

This project includes a Pages Function at `functions/api/[[path]].js`. It proxies `/api/*` requests to the Worker, so the browser can use same-origin URLs and doesn't need to know API credentials.

1. Put the whole project (`public/`, `functions/`, `worker.js`, and `wrangler.toml`) in a GitHub repository.
2. In Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
3. Choose the repository.
4. Framework preset: None.
5. Build command: leave empty.
6. Build output directory: `public`.
7. Deploy and open the resulting `pages.dev` URL.
8. In Pages → your project → Settings → Variables and Secrets, add `BACKEND_WORKER_URL` as a variable with the deployed Worker origin only, e.g. `https://bonnie-mobile-spares-api.<your-subdomain>.workers.dev` (no trailing slash).
9. Redeploy the Pages project after adding the variable.

Cloudflare Pages must be deployed from the repository root so it can discover the root-level `functions/` directory while serving `public/` as the output directory.

## 7. Test before announcing the site

1. Open `/api/health` on the deployed Worker and confirm it reports `ok: true`.
2. Open the Pages website and confirm all five branch names load.
3. Submit a test enquiry with your own approved test contacts.
4. Confirm exactly one row is appended to `Bookings`.
5. Confirm the selected branch manager and central number receive the approved template notification.
6. Test a malformed request and confirm it does not create a row.
7. Check Worker logs and Meta message status if a notification fails.

## Current MVP limitations

- No admin dashboard yet.
- No rate limiting / CAPTCHA yet; add before broad public promotion.
- WhatsApp failures are logged but not automatically retried. The booking row is saved first so the enquiry is not lost.
- Notifications are WhatsApp template messages, not arbitrary free-form messages.
- Do not store sensitive customer data that is not needed to respond to the enquiry.
