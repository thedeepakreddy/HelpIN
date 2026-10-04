# 08 · Deploying HelpIn (Render + Neon, free tier)

HelpIn deploys as **one Render web service** that serves the web app, the API and the background
worker from a single address (`https://<name>.onrender.com`), plus a **Neon** Postgres database.
Both have free tiers. The service config lives in [`render.yaml`](../render.yaml).

| Piece | Free tier limits that matter for a test |
|---|---|
| Render web service (free) | Sleeps after ~15 idle minutes; the next visit takes about a minute to wake it. Live updates pause while it sleeps. |
| Neon Postgres (free) | Small storage (enough for a beta); its compute also sleeps when idle and wakes in about a second. |

Upgrading later is two changes: the Render plan to **Starter** (always on), and optionally a
paid database.

## 1. Database: Neon

1. Sign up at [neon.tech](https://neon.tech) and create a project named `helpin`, region
   **AWS Europe Central (Frankfurt)**, Postgres 16 or newer.
2. Open **Connect**, turn **Connection pooling off**, and copy the connection string. It looks like
   `postgresql://user:password@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`.
   (HelpIn's live updates use Postgres `LISTEN`, which needs the direct connection, not the
   pooled one whose host contains `-pooler`.)
3. That string is `DATABASE_URL` in step 3. The server creates all tables itself on first start.

## 2. Email and photos

Follow [07-email-and-storage.md](07-email-and-storage.md) for Brevo and Cloudflare R2. In the
R2 CORS policy, list your Render address (`https://<name>.onrender.com`) as an allowed origin.

## 3. Secrets in the Render dashboard

Open the service → **Environment** and add the values that are not in `render.yaml`:

| Key | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `SMTP_USER`, `SMTP_PASS` | Brevo SMTP login and key |
| `EMAIL_FROM` | e.g. `HelpIn <hello@your-domain>` (a sender verified in Brevo) |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from R2 |
| `ADMIN_EMAILS` | your email; signing in with it makes you the admin |

Never commit these or paste them into chats. Saving them redeploys the service.

## 4. Private test mode (no SMS yet)

Until Twilio is set up, `SMS_PROVIDER=console` with `CODES_IN_LOGS=true` writes each sign-in code
to the Render log instead of texting it. Only people who can open your Render dashboard can read
it, so **only you can sign in**. To sign in on your phone:

1. Open the app address on your phone and enter your phone number.
2. In the Render dashboard → the service → **Logs**, find the line
   `[sms → +36…] 123456 is your HelpIn code` and type that code on your phone.

When you're ready to invite people: add a Twilio account, set `SMS_PROVIDER=twilio` and the three
`TWILIO_*` values, and delete `CODES_IN_LOGS`.

## 5. On your phone

- **Android (Chrome):** open the address, then menu → *Add to Home screen* / *Install app*.
- **iPhone (Safari):** open the address, then Share → *Add to Home Screen*, open HelpIn from the
  Home Screen, and turn on notifications from there (iOS only allows web push for installed apps).

Push notification keys are generated automatically on the first start and kept in the database.
