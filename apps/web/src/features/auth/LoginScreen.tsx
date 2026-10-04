import { useId, useState, type FormEvent, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, Check, Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../api/hooks';
import { ApiError } from '../../api';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../lib/errors';
import { Confetti, Hexies, Logo, type HexieMood } from '../../components/domain/Hexies';
import { Button } from '../../components/ui/Button';
import { Segmented } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';

/**
 * Sign in (ADR-018, revised): log in with email + password, create an account with the form,
 * reset a forgotten password with an email code, or sign in with a one-time code instead.
 * The phone is verified later, only when someone raises or offers help on a problem.
 */
type View = 'login' | 'signup' | 'forgot' | 'forgot-code' | 'code-contact' | 'code' | 'success';
type CodeMode = 'phone' | 'email';
type Focus = 'name' | 'email' | 'password' | 'contact' | 'code' | null;
const MAX_TRIES = 3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MIN_PASSWORD = 8;

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const toast = useToast();
  const search = useSearch({ from: '/public/login' });

  const [view, setView] = useState<View>(search.mode === 'signup' ? 'signup' : 'login');
  const [focus, setFocus] = useState<Focus>(null);
  const [busy, setBusy] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adult, setAdult] = useState(false);
  const [rules, setRules] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // One-time code flow (sign in with a code, or forgot password)
  const [codeMode, setCodeMode] = useState<CodeMode>('phone');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [sentTo, setSentTo] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);

  const digits = contact.replace(/\D/g, '');
  const contactValid = codeMode === 'phone' ? digits.length >= 9 : EMAIL_RE.test(contact.trim());
  const emailValid = EMAIL_RE.test(email.trim());
  const locked = attempts >= MAX_TRIES;
  const onCodeStep = view === 'code' || view === 'forgot-code';

  // The Hexies react to what you do (docs/06-ui-spec.md §4.3), and look away from passwords.
  let mood: HexieMood = 'neutral';
  if (view === 'success') mood = 'happy';
  else if (onCodeStep && locked) mood = 'sleepy';
  else if ((onCodeStep && codeError) || formError) mood = 'sad';
  const covering = mood === 'neutral' && !busy && (focus === 'password' || (onCodeStep && (focus === 'code' || code.length > 0)));
  const typed = focus === 'email' ? email : focus === 'name' ? name : focus === 'contact' ? contact : '';
  let look = { x: 0, y: 0 };
  if (mood === 'sad') look = { x: 0, y: 0.8 };
  else if (busy) look = { x: 0, y: 1 };
  else if (focus === 'email' || focus === 'name' || focus === 'contact') look = { x: -0.9 + 1.8 * (Math.min(typed.length, 18) / 18), y: 0.75 };

  let bubble = t('login.bubble.hello');
  if (view === 'success') bubble = t('login.bubble.success');
  else if (onCodeStep && locked) bubble = t('login.bubble.locked');
  else if (onCodeStep && codeError) bubble = t('login.bubble.wrong');
  else if (formError) bubble = t('login.bubble.wrongPassword');
  else if (busy) bubble = t('login.bubble.checking');
  else if (covering) bubble = t('login.bubble.notPeeking');
  else if (onCodeStep) bubble = t('login.bubble.checkMessages');
  else if (view === 'signup') bubble = t('login.bubble.signup');
  else if (focus) bubble = t('login.bubble.watching');

  const done = (me: { onboarding: { done: boolean } }) => {
    setOnboarded(me.onboarding.done);
    setView('success');
    setFocus(null);
  };

  const go = (v: View) => {
    setView(v);
    setFormError(null);
    setCodeError(false);
    setCode('');
    setAttempts(0);
    setFocus(null);
  };

  async function login(e: FormEvent) {
    e.preventDefault();
    if (!emailValid || !password || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      done(await session.login(email.trim(), password));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WRONG_PASSWORD') setFormError(t('login.wrongPassword'));
      else toast(errorMessage(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function signup(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !emailValid || password.length < MIN_PASSWORD || !adult || !rules || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      done(await session.signup({ displayName: name.trim(), email: email.trim(), password, adult: true, guidelines: true }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') setFormError(t('login.emailTaken'));
      else toast(errorMessage(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(e: FormEvent | MouseEvent, forgot = view === 'forgot' || view === 'forgot-code') {
    e.preventDefault();
    const channel = forgot ? 'email' : codeMode === 'phone' ? 'sms' : 'email';
    const destination = forgot ? email.trim() : codeMode === 'phone' ? (contact.trim().startsWith('+') ? contact.trim() : `+36${digits}`) : contact.trim();
    if ((forgot ? !emailValid : !contactValid) || busy) return;
    setBusy(true);
    try {
      const res = await session.requestCode(channel, destination);
      setSentTo(res.sentTo);
      setChallengeId(res.challengeId);
      setDevCode(res.devCode ?? null);
      setView(forgot ? 'forgot-code' : 'code');
      setCode('');
      setCodeError(false);
      setAttempts(0);
    } catch (err) {
      toast(errorMessage(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const resetting = view === 'forgot-code';
    if (code.length !== 6 || locked || busy || (resetting && password.length < MIN_PASSWORD)) return;
    setBusy(true);
    try {
      done(resetting ? await session.resetPassword(challengeId, code, password) : await session.verifyCode(challengeId, code));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CODE_MISMATCH') {
        setCodeError(true);
        setAttempts((a) => a + 1);
        setCode('');
      } else if (err instanceof ApiError && err.status === 429) {
        setAttempts(MAX_TRIES);
      } else {
        toast(errorMessage(err, t), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  const field = (f: Focus) => ({ onFocus: () => setFocus(f), onBlur: () => setFocus(null) });

  return (
    <div className="min-h-dvh bg-paper md:flex md:items-center md:justify-center md:bg-brand md:p-8">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-hidden bg-paper md:min-h-[820px] md:rounded-[36px] md:shadow-2xl">
        <div aria-hidden className="absolute inset-x-0 top-0 h-[300px] bg-brand" />

        <header className="relative flex items-center justify-between px-5 pt-5">
          {view === 'login' || view === 'signup' || view === 'success' ? (
            <Link to="/welcome" aria-label={t('common.back')} className="-ml-2 flex size-10 items-center justify-center rounded-full text-white hover:bg-white/10">
              <ArrowLeft size={22} />
            </Link>
          ) : (
            <button type="button" aria-label={t('common.back')} onClick={() => go('login')} className="-ml-2 flex size-10 items-center justify-center rounded-full text-white hover:bg-white/10">
              <ArrowLeft size={22} />
            </button>
          )}
          <Logo onDark className="text-[20px]" />
          <span className="w-8" />
        </header>

        <div className="relative h-[220px]">
          <div
            aria-live="polite"
            className="absolute top-2.5 left-1/2 w-max max-w-[320px] -translate-x-1/2 rounded-[18px] bg-white px-4 py-2.5 text-center text-[14px] leading-snug font-bold shadow-[0_6px_18px_rgb(20_32_27/0.1)]"
          >
            {bubble}
            <span aria-hidden className="absolute -bottom-[7px] left-1/2 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px] bg-white" />
          </div>
          <div className="absolute inset-x-0 top-[66px] origin-top scale-[0.86]">
            <Hexies mood={mood} look={look} covering={covering} />
          </div>
          {view === 'success' && <Confetti />}
        </div>

        <div className="relative px-5 pb-8">
          <div className="rounded-[26px] bg-white px-5 pt-5 pb-5 shadow-[0_12px_32px_rgb(20_32_27/0.08)]">
            {(view === 'login' || view === 'signup') && (
              <Segmented
                label={t('login.title')}
                value={view}
                onChange={(v) => go(v)}
                options={[
                  { value: 'login', label: t('login.tabLogin') },
                  { value: 'signup', label: t('login.tabSignup') },
                ]}
                className="mb-4"
              />
            )}

            {view === 'login' && (
              <form onSubmit={login} noValidate className="flex flex-col gap-3.5">
                <Field label={t('login.emailLabel')} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} focused={focus === 'email'} {...field('email')} />
                <PasswordField label={t('login.password')} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} focused={focus === 'password'} {...field('password')} />
                {formError && (
                  <p role="alert" className="-mt-1 text-[13px] font-semibold text-coral-ink">
                    {formError}
                  </p>
                )}
                <Button type="submit" size="lg" block disabled={!emailValid || !password} loading={busy}>
                  {t('login.logIn')}
                </Button>
                <div className="flex justify-between text-[13px]">
                  <button type="button" className="font-bold text-brand" onClick={() => go('forgot')}>
                    {t('login.forgot')}
                  </button>
                  <button type="button" className="font-bold text-ink-2" onClick={() => go('code-contact')}>
                    {t('login.useCode')}
                  </button>
                </div>
              </form>
            )}

            {view === 'signup' && (
              <form onSubmit={signup} noValidate className="flex flex-col gap-3.5">
                <Field label={t('login.name')} autoComplete="name" placeholder={t('login.namePlaceholder')} maxLength={50} value={name} onChange={(e) => setName(e.target.value)} focused={focus === 'name'} {...field('name')} />
                <Field label={t('login.emailLabel')} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} focused={focus === 'email'} {...field('email')} />
                <PasswordField
                  label={t('login.password')}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  focused={focus === 'password'}
                  hint={password.length > 0 && password.length < MIN_PASSWORD ? t('login.passwordShort', { count: MIN_PASSWORD }) : t('login.passwordHint', { count: MIN_PASSWORD })}
                  warn={password.length > 0 && password.length < MIN_PASSWORD}
                  {...field('password')}
                />
                <Agree checked={adult} onChange={setAdult}>
                  {t('login.adult')}
                </Agree>
                <Agree checked={rules} onChange={setRules}>
                  {t('login.rulesBefore')}{' '}
                  <Link to="/legal/$page" params={{ page: 'guidelines' }} className="font-bold text-brand" target="_blank">
                    {t('legal.guidelines')}
                  </Link>{' '}
                  {t('login.rulesAfter')}
                </Agree>
                {formError && (
                  <p role="alert" className="-mt-1 text-[13px] font-semibold text-coral-ink">
                    {formError}{' '}
                    <button type="button" className="font-bold text-brand" onClick={() => go('login')}>
                      {t('login.tabLogin')}
                    </button>
                  </p>
                )}
                <Button type="submit" size="lg" block disabled={!name.trim() || !emailValid || password.length < MIN_PASSWORD || !adult || !rules} loading={busy}>
                  {t('login.createAccount')}
                </Button>
                <p className="text-center text-[12px] leading-relaxed text-muted">{t('login.signupNote')}</p>
              </form>
            )}

            {view === 'forgot' && (
              <form onSubmit={(e) => void sendCode(e, true)} noValidate className="flex flex-col gap-3.5">
                <h1 className="font-display text-[24px] font-extrabold tracking-tight">{t('login.forgotTitle')}</h1>
                <p className="-mt-2 text-[14px] text-ink-2">{t('login.forgotBody')}</p>
                <Field label={t('login.emailLabel')} type="email" inputMode="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} focused={focus === 'email'} {...field('email')} />
                <Button type="submit" size="lg" block disabled={!emailValid} loading={busy}>
                  {t('login.sendCode')}
                </Button>
              </form>
            )}

            {view === 'code-contact' && (
              <form onSubmit={(e) => void sendCode(e, false)} noValidate>
                <h1 className="font-display text-[24px] font-extrabold tracking-tight">{t('login.codeSignInTitle')}</h1>
                <p className="mt-1 mb-4 text-[14px] text-ink-2">{t('login.subtitle')}</p>
                <Segmented
                  label={t('login.signInWith')}
                  value={codeMode}
                  onChange={(m) => {
                    setCodeMode(m);
                    setContact('');
                  }}
                  options={[
                    { value: 'phone', label: t('login.phone') },
                    { value: 'email', label: t('login.email') },
                  ]}
                  className="mb-3.5"
                />
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-bold">{codeMode === 'phone' ? t('login.phoneLabel') : t('login.emailLabel')}</span>
                  <span className={cn('flex h-14 items-center rounded-2xl border-2 bg-[#F9FAF7] transition-colors', focus === 'contact' ? 'border-brand bg-white' : 'border-line')}>
                    {codeMode === 'phone' && <span className="border-r border-line px-3.5 text-[17px] font-bold text-ink-2">+36</span>}
                    <input
                      type={codeMode === 'phone' ? 'tel' : 'email'}
                      inputMode={codeMode === 'phone' ? 'tel' : 'email'}
                      autoComplete={codeMode === 'phone' ? 'tel-national' : 'email'}
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      {...field('contact')}
                      placeholder={codeMode === 'phone' ? '30 123 4567' : 'you@example.com'}
                      className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[17px] text-ink outline-none placeholder:text-muted/70"
                    />
                  </span>
                </label>
                <Button type="submit" size="lg" block disabled={!contactValid} loading={busy} className="mt-4">
                  {t('login.sendCode')}
                </Button>
              </form>
            )}

            {onCodeStep && (
              <form onSubmit={verifyCode} noValidate>
                <h1 className="font-display text-[24px] font-extrabold tracking-tight">{view === 'forgot-code' ? t('login.resetTitle') : t('login.codeTitle')}</h1>
                <p className="mt-1 mb-4 text-[14px] text-ink-2">
                  {t('login.sentTo')} <strong className="text-ink">{sentTo}</strong> ·{' '}
                  <button type="button" onClick={() => go(view === 'forgot-code' ? 'forgot' : 'code-contact')} className="font-bold text-brand">
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
                      setCodeError(false);
                    }}
                    {...field('code')}
                    placeholder="••••••"
                    aria-invalid={codeError || locked || undefined}
                    className={cn(
                      'h-15 w-full rounded-2xl border-2 bg-[#F9FAF7] text-center text-[28px] font-extrabold tracking-[12px] text-ink outline-none transition-colors',
                      codeError || locked ? 'border-coral' : focus === 'code' ? 'border-brand bg-white' : 'border-line',
                    )}
                  />
                </label>
                {codeError && !locked && (
                  <p role="alert" className="mt-2 text-[13px] font-semibold text-coral-ink">
                    {t('login.wrongCode', { count: MAX_TRIES - attempts })}
                  </p>
                )}
                {locked && (
                  <p role="alert" className="mt-2 text-[13px] font-semibold text-coral-ink">
                    {t('login.locked')}
                  </p>
                )}
                {view === 'forgot-code' && (
                  <PasswordField
                    className="mt-3.5"
                    label={t('login.newPassword')}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    focused={focus === 'password'}
                    hint={t('login.passwordHint', { count: MIN_PASSWORD })}
                    warn={password.length > 0 && password.length < MIN_PASSWORD}
                    {...field('password')}
                  />
                )}
                <Button type="submit" size="lg" block disabled={code.length !== 6 || locked || (view === 'forgot-code' && password.length < MIN_PASSWORD)} loading={busy} className="mt-3.5">
                  {busy ? t('login.checking') : view === 'forgot-code' ? t('login.savePassword') : t('login.verify')}
                </Button>
                <div className="mt-3 flex justify-between text-[13px] text-muted">
                  <button type="button" disabled={busy} onClick={(e) => void sendCode(e)} className="font-bold text-brand disabled:text-muted">
                    {t('login.resend')}
                  </button>
                  {devCode && <span className="font-semibold">{t('login.devCode', { code: devCode })}</span>}
                </div>
              </form>
            )}

            {view === 'success' && (
              <div className="py-1.5 text-center">
                <div className="mx-auto flex size-15 items-center justify-center rounded-full bg-brand-tint text-brand">
                  <Check size={30} strokeWidth={2.8} />
                </div>
                <h1 className="mt-3.5 font-display text-[28px] font-extrabold">{t('login.successTitle')}</h1>
                <p className="mt-1.5 mb-5 text-[15px] text-ink-2">{t('login.successBody')}</p>
                <Button size="lg" block onClick={() => void navigate(onboarded ? { to: '/problems', search: { view: 'map' } } : { to: '/onboarding' })}>
                  {onboarded ? t('login.letsGo') : t('login.setUp')}
                </Button>
              </div>
            )}
          </div>
          {(view === 'login' || view === 'signup') && <p className="mt-4 text-center text-[12px] text-muted">{t('login.agree')}</p>}
        </div>
      </div>
    </div>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; focused: boolean; hint?: string; warn?: boolean };

function Field({ label, focused, hint, warn, className, ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold">
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(
          'h-13 w-full rounded-2xl border-2 bg-[#F9FAF7] px-4 text-[16px] text-ink outline-none transition-colors placeholder:text-muted/70',
          focused ? 'border-brand bg-white' : 'border-line',
        )}
      />
      {hint && (
        <p id={`${id}-hint`} className={cn('mt-1.5 text-[12px]', warn ? 'font-semibold text-coral-ink' : 'text-muted')}>
          {hint}
        </p>
      )}
    </div>
  );
}

function PasswordField({ label, focused, hint, warn, className, ...rest }: FieldProps) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-bold">
        {label}
      </label>
      <span className={cn('flex h-13 items-center rounded-2xl border-2 bg-[#F9FAF7] transition-colors', focused ? 'border-brand bg-white' : 'border-line')}>
        <input id={id} {...rest} aria-describedby={hint ? `${id}-hint` : undefined} type={show ? 'text' : 'password'} className="h-full min-w-0 flex-1 bg-transparent px-4 text-[16px] text-ink outline-none" />
        <button
          type="button"
          aria-label={show ? t('login.hidePassword') : t('login.showPassword')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShow((s) => !s)}
          className="flex size-11 shrink-0 items-center justify-center text-ink-2"
        >
          {show ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
      </span>
      {hint && (
        <p id={`${id}-hint`} className={cn('mt-1.5 text-[12px]', warn ? 'font-semibold text-coral-ink' : 'text-muted')}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Agree({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-[#F9FAF7] p-3">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-brand" />
      <span className="text-[14px] leading-snug text-ink-2">{children}</span>
    </label>
  );
}
