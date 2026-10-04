import nodemailer from 'nodemailer';
import type { Env } from './env';

/** SMS and email are adapters so the provider can change without touching modules (ADR-029). */
export interface SmsSender {
  readonly kind: string;
  send(to: string, text: string): Promise<void>;
}
export interface EmailSender {
  readonly kind: string;
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface Outbox {
  sms: { to: string; text: string }[];
  email: { to: string; subject: string; text: string }[];
}

/** Development / test: messages are logged and kept in memory. */
export function consoleMessaging(log: (msg: string) => void = console.log): { sms: SmsSender; email: EmailSender; sent: Outbox } {
  const sent: Outbox = { sms: [], email: [] };
  return {
    sent,
    sms: {
      kind: 'console',
      async send(to, text) {
        sent.sms.push({ to, text });
        log(`[sms → ${to}] ${text}`);
      },
    },
    email: {
      kind: 'console',
      async send(to, subject, text) {
        sent.email.push({ to, subject, text });
        log(`[email → ${to}] ${subject}: ${text}`);
      },
    },
  };
}

function twilio(env: Env): SmsSender {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  if (!sid || !token || !from) throw new Error('Twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
  return {
    kind: 'twilio',
    async send(to, text) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
      });
      if (!res.ok) throw new Error(`SMS failed: ${res.status}`);
    },
  };
}

/** Any SMTP relay. Brevo: SMTP_HOST=smtp-relay.brevo.com, port 587 (STARTTLS), login + SMTP key. */
export function smtpTransport(env: Env) {
  if (env.SMTP_URL) return nodemailer.createTransport(env.SMTP_URL);
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) throw new Error('SMTP needs SMTP_URL, or SMTP_HOST, SMTP_USER and SMTP_PASS');
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Never let a slow relay hold a sign-in request (or the worker) for long.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

function smtp(env: Env): EmailSender {
  const transport = smtpTransport(env);
  return {
    kind: 'smtp',
    async send(to, subject, text) {
      await transport.sendMail({ from: env.EMAIL_FROM, to, subject, text });
    },
  };
}

export function messagingFromEnv(env: Env, log?: (m: string) => void) {
  const dev = consoleMessaging(log);
  return {
    sms: env.SMS_PROVIDER === 'twilio' ? twilio(env) : dev.sms,
    email: env.EMAIL_PROVIDER === 'smtp' ? smtp(env) : dev.email,
    sent: dev.sent,
  };
}
