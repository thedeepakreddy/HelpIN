# 07 · Email (Brevo) and photo storage (Cloudflare R2)

HelpIn sends sign-in codes and important notifications by email through **Brevo**, and stores
photos in **Cloudflare R2**. Both have free tiers that cover the beta: Brevo sends 300 emails a
day, and R2 stores 10 GB a month with no download fees. Both plug into existing adapters
(ADR-029), so you only need to set environment variables.

When you're done, this checks everything end to end (it sends a real test email and does a
real upload, exactly like a browser):

```bash
pnpm --filter @helpin/api check:providers -- --email you@example.com
```

---

## Brevo (email)

1. **Create an account** at [brevo.com](https://www.brevo.com) (the free plan is enough).
2. **Verify where emails come from.** Go to *Senders, Domains & Dedicated IPs*:
   - Best: **add your domain** (e.g. `helpin.hu`) and add the DNS records Brevo shows
     (DKIM, DMARC, the Brevo code). Emails from your own domain reach inboxes; emails "from" a
     Gmail address sent by Brevo usually land in spam or get rejected.
   - For a quick test you can verify a single sender address instead.
3. **Create an SMTP key.** Go to *SMTP & API* → *SMTP* → *Generate a new SMTP key*. Copy the
   key (it's shown once) and the **Login** shown on the same page (it looks like
   `xxxxxxxxx@smtp-brevo.com`).
4. **Set these in `apps/api/.env`** (or your host's secret settings):

   ```bash
   EMAIL_PROVIDER=smtp
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=xxxxxxxxx@smtp-brevo.com
   SMTP_PASS=xsmtpsib-your-key
   EMAIL_FROM=HelpIn <hello@your-domain>
   ```

   `EMAIL_FROM` must use the sender or domain you verified in step 2.

The free plan adds a small Brevo logo to each email's footer; the Starter plan removes it.

## Cloudflare R2 (photos)

1. **Create a Cloudflare account** and open **R2 Object Storage**. Cloudflare asks for a payment
   method before enabling R2, even though the first 10 GB a month are free.
2. **Create a bucket**, e.g. `helpin-media`. Under *Location*, choose **Specify jurisdiction →
   European Union** so photos stay in the EU (privacy notice, GDPR). Leave public access **off**:
   HelpIn serves photos through short-lived signed links.
3. **Allow uploads from the web app (CORS).** Browsers upload photos straight to the bucket, so
   open the bucket → *Settings* → *CORS policy* → *Edit* and paste, with your real web address:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5173", "https://your-web-app.example"],
       "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. **Create an API token.** In R2 → *Manage R2 API Tokens* → *Create API token*: permission
   **Object Read & Write**, limited to the `helpin-media` bucket. Copy the **Access Key ID** and
   **Secret Access Key** (shown once).
5. **Find your endpoint.** It's on the bucket's *Settings* page under *S3 API*:
   `https://<account id>.eu.r2.cloudflarestorage.com` for an EU bucket (without `.eu` otherwise).
   Use the address **without** the bucket name at the end.
6. **Set these in `apps/api/.env`:**

   ```bash
   STORAGE_DRIVER=s3
   S3_ENDPOINT=https://<account id>.eu.r2.cloudflarestorage.com
   S3_REGION=auto
   S3_BUCKET=helpin-media
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```

How photos flow: the browser shrinks a photo and uploads it to `quarantine/` with a link that
expires in 15 minutes. The worker reads it, rejects anything over 10 MB, strips all metadata
(including GPS), writes three WebP sizes under `media/`, and deletes the original (L-08).

Photos uploaded while `STORAGE_DRIVER=local` stay on that machine's disk; switching to R2 does
not move them. For a fresh start, run `pnpm db:reset && pnpm db:seed` after switching.

## If the check fails

| Message | Fix |
|---|---|
| SMTP login failed | Use the Brevo **Login** (not your account email) and an **SMTP key** (not your password). |
| Sending failed | `EMAIL_FROM` isn't a verified sender or domain in Brevo. |
| CORS preflight was refused | The CORS policy is missing, or doesn't list the exact `WEB_URL` (scheme, host and port). |
| Presigned upload failed (403) | Wrong keys, or the token isn't allowed to write to this bucket. |
| Storage error / not found | Check `S3_ENDPOINT` (no bucket name at the end), `S3_BUCKET` and `S3_REGION=auto`. |
