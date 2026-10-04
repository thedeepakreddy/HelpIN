/**
 * Checks the email and storage providers configured in .env, end to end:
 *
 *   pnpm --filter @helpin/api check:providers -- --email you@example.com
 *
 * Email: logs in to the SMTP relay (Brevo) and sends a test message to --email.
 * Storage: does what a browser does (CORS preflight + presigned PUT), then what the worker does
 * (read, write, presigned GET) and cleans up. Nothing is written to the database.
 */
import { randomUUID } from 'node:crypto';
import { loadEnv } from '../platform/env';
import { smtpTransport } from '../platform/messaging';
import { storageFromEnv } from '../platform/storage';

const env = loadEnv();
const args = process.argv.slice(2);
const emailTo = args.includes('--email') ? (args[args.indexOf('--email') + 1] ?? null) : null;
let failed = false;

const ok = (m: string) => console.log(`  ✓ ${m}`);
const fail = (m: string, hint?: string) => {
  failed = true;
  console.log(`  ✗ ${m}${hint ? `\n    → ${hint}` : ''}`);
};

async function checkEmail() {
  console.log(`\nEmail (${env.EMAIL_PROVIDER})`);
  if (env.EMAIL_PROVIDER !== 'smtp') return console.log('  – console provider: codes are printed in the API log. Set EMAIL_PROVIDER=smtp to use Brevo.');
  let transport;
  try {
    transport = smtpTransport(env);
    await transport.verify();
    ok(`logged in to ${env.SMTP_HOST ?? 'the SMTP relay'}`);
  } catch (e) {
    return fail(`SMTP login failed: ${(e as Error).message}`, 'Brevo → SMTP & API → SMTP: use the "Login" as SMTP_USER and an SMTP key (not your password) as SMTP_PASS.');
  }
  if (!emailTo) return console.log('  – add --email you@example.com to send a test message');
  try {
    const info = await transport.sendMail({ from: env.EMAIL_FROM, to: emailTo, subject: 'HelpIn test email', text: 'If you can read this, HelpIn can send sign-in codes by email.' });
    ok(`sent a test email to ${emailTo} (${info.messageId}). Check the inbox and the spam folder.`);
  } catch (e) {
    fail(`sending failed: ${(e as Error).message}`, `EMAIL_FROM (${env.EMAIL_FROM}) must be a sender or domain verified in Brevo → Senders, Domains & Dedicated IPs.`);
  }
}

async function checkStorage() {
  console.log(`\nStorage (${env.STORAGE_DRIVER})`);
  if (env.STORAGE_DRIVER !== 's3') return console.log(`  – local driver: files live in ${env.STORAGE_DIR}. Set STORAGE_DRIVER=s3 to use Cloudflare R2.`);
  const storage = storageFromEnv(env);
  const key = `quarantine/provider-check-${randomUUID()}`;
  const origin = env.WEB_URL;
  const body = Buffer.from('helpin provider check');
  try {
    const { url, headers } = await storage.uploadUrl(key, 'image/jpeg', 300);

    // 1. What the browser asks before uploading cross-origin.
    const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
    const allowed = pre.headers.get('access-control-allow-origin');
    if (pre.ok && (allowed === origin || allowed === '*')) ok(`CORS allows uploads from ${origin}`);
    else fail(`CORS preflight from ${origin} was refused (${pre.status})`, `R2 bucket → Settings → CORS policy: allow ${origin} with PUT and GET, header Content-Type (see docs/07-email-and-storage.md).`);

    // 2. The upload itself.
    const put = await fetch(url, { method: 'PUT', headers: { ...headers, Origin: origin }, body });
    if (!put.ok) {
      const text = await put.text();
      return fail(`presigned upload failed (${put.status}): ${text.slice(0, 200)}`, /Signature|AccessDenied|InvalidAccessKeyId/.test(text) ? 'Check S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and that the API token can write to this bucket.' : undefined);
    }
    ok('a browser-style upload to a presigned link works');

    // 3. What the worker does.
    const read = await storage.get(key);
    if (!read.equals(body)) return fail('read back different bytes than were uploaded');
    ok('the server can read uploads');
    const outKey = `media/provider-check-${randomUUID()}/320.webp`;
    await storage.put(outKey, body, 'image/webp');
    const get = await fetch(await storage.downloadUrl(outKey, 300));
    if (get.ok && Buffer.from(await get.arrayBuffer()).equals(body)) ok('processed photos can be served through signed links');
    else fail(`signed download failed (${get.status})`);
    await storage.remove(key);
    await storage.remove(outKey);
    ok('cleaned up');
  } catch (e) {
    fail(`storage error: ${(e as Error).message}`, 'Check S3_ENDPOINT (https://<account id>.r2.cloudflarestorage.com), S3_BUCKET, S3_REGION=auto and the keys.');
  }
}

await checkEmail();
await checkStorage();
console.log(failed ? '\nSome checks failed.' : '\nAll configured providers work.');
process.exit(failed ? 1 : 0);
