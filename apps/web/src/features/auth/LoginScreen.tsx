import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../api/hooks';
import { ApiError } from '../../api';
import { Confetti, Hexies, Logo, type HexieMood } from '../../components/domain/Hexies';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';

type Step = 'contact' | 'code' | 'success';
type Mode = 'phone' | 'email';
const MAX_TRIES = 3;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();

  const [mode, setMode] = useState<Mode>('phone');
  const [contact, setContact] = useState('');
  const [step, setStep] = useState<Step>('contact');
  const [code, setCode] = useState('');
  const [focus, setFocus] = useState<'contact' | 'code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [sentTo, setSentTo] = useState('');

  const digits = contact.replace(/\D/g, '');
  const valid = mode === 'phone' ? digits.length >= 9 : EMAIL_RE.test(contact.trim());
  const locked = attempts >= MAX_TRIES;

  // The Hexies react to what you do (docs/06-ui-spec.md §4.3).
  let mood: HexieMood = 'neutral';
  if (step === 'success') mood = 'happy';
  else if (step === 'code' && locked) mood = 'sleepy';
  else if (step === 'code' && error) mood = 'sad';
  const covering = step === 'code' && mood === 'neutral' && !busy && (focus === 'code' || code.length > 0);
  let look = { x: 0, y: 0 };
  if (mood === 'sad') look = { x: 0, y: 0.8 };
  else if (busy) look = { x: 0, y: 1 };
  else if (step === 'contact' && focus === 'contact') look = { x: -0.9 + 1.8 * (Math.min(contact.length, 14) / 14), y: 0.75 };
  else if (step === 'contact' && contact.length > 0) look = { x: 0, y: 0.5 };

  let bubble = t('login.bubble.hello');
  if (step === 'success') bubble = t('login.bubble.success');
  else if (step === 'code' && locked) bubble = t('login.bubble.locked');
  else if (step === 'code' && error) bubble = t('login.bubble.wrong');
  else if (busy) bubble = t('login.bubble.checking');
  else if (covering) bubble = t('login.bubble.notPeeking');
  else if (step === 'code') bubble = t('login.bubble.checkMessages');
  else if (valid) bubble = t('login.bubble.looksRight');
  else if (focus === 'contact' || contact.length > 0) bubble = t('login.bubble.watching');

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const full = mode === 'phone' ? `+36${digits}` : contact.trim();
      const res = await session.requestCode(full);
      setSentTo(mode === 'phone' ? `+36 ${contact.trim()}` : res.sentTo);
      setStep('code');
      setCode('');
      setError(false);
      setAttempts(0);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || locked || busy) return;
    setBusy(true);
    try {
      await session.verifyCode(code);
      setStep('success');
      setFocus(null);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(true);
        setAttempts((a) => a + 1);
        setCode('');
      } else throw err;
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setStep('contact');
    setContact('');
    setCode('');
    setError(false);
    setAttempts(0);
  }

  return (
    <div className="min-h-dvh bg-paper md:flex md:items-center md:justify-center md:bg-brand md:p-8">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-hidden bg-paper md:min-h-[820px] md:rounded-[36px] md:shadow-2xl">
        <div aria-hidden className="absolute inset-x-0 top-0 h-[344px] bg-brand" />

        <header className="relative flex items-center justify-between px-5 pt-5">
          <Link to="/welcome" aria-label={t('common.back')} className="-ml-2 flex size-10 items-center justify-center rounded-full text-white hover:bg-white/10">
            <ArrowLeft size={22} />
          </Link>
          <Logo onDark className="text-[20px]" />
          <span className="w-8" />
        </header>

        <div className="relative h-[262px]">
          <div
            aria-live="polite"
            className="absolute top-2.5 left-1/2 w-max max-w-[320px] -translate-x-1/2 rounded-[18px] bg-white px-4 py-2.5 text-center text-[14px] leading-snug font-bold shadow-[0_6px_18px_rgb(20_32_27/0.1)]"
          >
            {bubble}
            <span aria-hidden className="absolute -bottom-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-white" />
          </div>
          <div className="absolute inset-x-0 top-[70px]">
            <Hexies mood={mood} look={look} covering={covering} />
          </div>
          {step === 'success' && <Confetti />}
        </div>

        <div className="relative px-5 pb-8">
          <div className="rounded-[26px] bg-white px-5 pt-5.5 pb-5 shadow-[0_12px_32px_rgb(20_32_27/0.08)]">
            {step === 'contact' && (
              <form onSubmit={sendCode} noValidate>
                <h1 className="font-display text-[26px] font-extrabold tracking-tight">{t('login.title')}</h1>
                <p className="mt-1 mb-4 text-[14px] text-ink-2">{t('login.subtitle')}</p>
                <Segmented
                  label={t('login.signInWith')}
                  value={mode}
                  onChange={(m) => {
                    setMode(m);
                    setContact('');
                  }}
                  options={[
                    { value: 'phone', label: t('login.phone') },
                    { value: 'email', label: t('login.email') },
                  ]}
                  className="mb-3.5"
                />
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-bold">{mode === 'phone' ? t('login.phoneLabel') : t('login.emailLabel')}</span>
                  <span
                    className={cn(
                      'flex h-14 items-center rounded-2xl border-2 bg-[#F9FAF7] transition-colors',
                      focus === 'contact' ? 'border-brand bg-white' : 'border-line',
                    )}
                  >
                    {mode === 'phone' && <span className="border-r border-line px-3.5 text-[17px] font-bold text-ink-2">+36</span>}
                    <input
                      type={mode === 'phone' ? 'tel' : 'email'}
                      inputMode={mode === 'phone' ? 'tel' : 'email'}
                      autoComplete={mode === 'phone' ? 'tel-national' : 'email'}
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      onFocus={() => setFocus('contact')}
                      onBlur={() => setFocus(null)}
                      placeholder={mode === 'phone' ? '30 123 4567' : 'you@example.com'}
                      className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[17px] text-ink outline-none placeholder:text-muted/70"
                    />
                  </span>
                </label>
                {mode === 'email' && <p className="mt-2 text-[12px] text-muted">{t('login.phoneStillNeeded')}</p>}
                <Button type="submit" size="lg" block disabled={!valid} loading={busy} className="mt-4">
                  {t('login.sendCode')}
                </Button>
                <p className="mt-3 text-center text-[12px] text-muted">{t('login.agree')}</p>
              </form>
            )}

            {step === 'code' && (
              <form onSubmit={verify} noValidate>
                <h1 className="font-display text-[26px] font-extrabold tracking-tight">{t('login.codeTitle')}</h1>
                <p className="mt-1 mb-4 text-[14px] text-ink-2">
                  {t('login.sentTo')} <strong className="text-ink">{sentTo}</strong> ·{' '}
                  <button type="button" onClick={startOver} className="font-bold text-brand">
                    {t('login.change')}
                  </button>
                </p>
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-bold">{t('login.codeLabel')}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    disabled={locked}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setError(false);
                    }}
                    onFocus={() => setFocus('code')}
                    onBlur={() => setFocus(null)}
                    placeholder="••••••"
                    aria-invalid={error || locked || undefined}
                    className={cn(
                      'h-15 w-full rounded-2xl border-2 bg-[#F9FAF7] text-center text-[28px] font-extrabold tracking-[12px] text-ink outline-none transition-colors',
                      error || locked ? 'border-coral' : focus === 'code' ? 'border-brand bg-white' : 'border-line',
                    )}
                  />
                </label>
                {error && !locked && (
                  <p role="alert" className="mt-2 text-[13px] font-semibold text-coral-ink">
                    {t('login.wrongCode', { count: MAX_TRIES - attempts })}
                  </p>
                )}
                {locked && (
                  <p role="alert" className="mt-2 text-[13px] font-semibold text-coral-ink">
                    {t('login.locked')}
                  </p>
                )}
                <Button type="submit" size="lg" block disabled={code.length !== 6 || locked} loading={busy} className="mt-3.5">
                  {busy ? t('login.checking') : t('login.verify')}
                </Button>
                <div className="mt-3 flex justify-between text-[13px] text-muted">
                  <span>{t('login.resendIn', { time: '0:24' })}</span>
                  {locked ? (
                    <button type="button" onClick={startOver} className="font-bold text-brand">
                      {t('login.startOver')}
                    </button>
                  ) : (
                    <span className="font-semibold">{t('login.demoCode')}</span>
                  )}
                </div>
              </form>
            )}

            {step === 'success' && (
              <div className="py-1.5 text-center">
                <div className="mx-auto flex size-15 items-center justify-center rounded-full bg-brand-tint text-brand">
                  <Check size={30} strokeWidth={2.8} />
                </div>
                <h1 className="mt-3.5 font-display text-[28px] font-extrabold">{t('login.successTitle')}</h1>
                <p className="mt-1.5 mb-5 text-[15px] text-ink-2">{t('login.successBody')}</p>
                <Button size="lg" block onClick={() => void navigate({ to: '/problems' })}>
                  {t('login.letsGo')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
