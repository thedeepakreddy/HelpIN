import { Suspense, lazy, useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Bell, Check, HeartHandshake, MapPin, Share, ShieldCheck, Smartphone, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@helpin/config';
import { latLngToCell } from 'h3-js';
import { api } from '../../api';
import { useMe, useMeMutation, useSession, useSetHomeArea, useUpdateProfile } from '../../api/hooks';
import { Hexie, Logo } from '../../components/domain/Hexies';
import { usePhotoUploads } from '../../components/domain/media';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { HexAvatar, TextArea, TextField } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { enablePush, isIosBrowser } from '../../lib/push';
import { DEFAULT_VIEW } from '../problems/mapStyle';

const LocationPicker = lazy(() => import('../create/LocationPicker').then((m) => ({ default: m.LocationPicker })));

type Step = 'phone' | 'welcome' | 'profile' | 'area' | 'notifications';

/** Onboarding (Roadmap Phase 1): phone · 18+ & guidelines · profile · home area · notifications. */
export function OnboardingScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const [finishing, setFinishing] = useState(false);
  if (!me.data) return null;
  const o = me.data.onboarding;
  const step: Step = !me.data.phoneVerified ? 'phone' : !o.adultConfirmed || !o.guidelinesAccepted ? 'welcome' : !o.profileDone ? 'profile' : !o.homeAreaSet ? 'area' : 'notifications';
  const steps: Step[] = ['phone', 'welcome', 'profile', 'area', 'notifications'];
  const index = steps.indexOf(finishing ? 'notifications' : step);

  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pt-[max(20px,env(safe-area-inset-top))] pb-8">
        <header className="flex items-center justify-between">
          <Logo />
          <span className="text-[13px] font-semibold text-muted">
            {index + 1} / {steps.length}
          </span>
        </header>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
        </div>
        <main className="mt-7 flex flex-1 flex-col">
          {step === 'phone' && <PhoneStep />}
          {step === 'welcome' && <WelcomeStep />}
          {step === 'profile' && <ProfileStep />}
          {step === 'area' && <AreaStep onDone={() => setFinishing(true)} />}
          {step === 'notifications' && <NotificationsStep />}
        </main>
        <p className="mt-6 text-center text-[12px] text-muted">
          <Link to="/legal/$page" params={{ page: 'privacy' }} className="text-muted">
            {t('legal.privacy')}
          </Link>{' '}
          ·{' '}
          <Link to="/legal/$page" params={{ page: 'guidelines' }} className="text-muted">
            {t('legal.guidelines')}
          </Link>
        </p>
      </div>
    </div>
  );
}

function Title({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mb-6">
      <span className="hex mb-4 flex h-14 w-12 items-center justify-center bg-brand-tint text-brand">{icon}</span>
      <h1 className="font-display text-[30px] leading-tight font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ 1. Phone (ADR-018) */

function PhoneStep() {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = useMeMutation((v: { id: string; code: string }) => api.verifyPhone(v.id, v.code));

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api.requestPhoneCode(phone.trim().startsWith('+') ? phone.trim() : `+36${phone.replace(/\D/g, '')}`);
      setChallenge({ id: c.challengeId, sentTo: c.sentTo, devCode: c.devCode });
    } catch (err) {
      toast(errorMessage(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Title icon={<Smartphone size={24} />} title={t('onboarding.phone.title')} body={t('onboarding.phone.body')} />
      {!challenge ? (
        <form onSubmit={send} className="flex flex-col gap-4">
          <TextField label={t('login.phoneLabel')} type="tel" inputMode="tel" autoComplete="tel" placeholder="+36 30 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button type="submit" size="lg" block loading={busy} disabled={phone.replace(/\D/g, '').length < 9}>
            {t('login.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate({ id: challenge.id, code }, { onError: (err) => toast(errorMessage(err, t), 'error') });
          }}
          className="flex flex-col gap-4"
        >
          <TextField
            label={`${t('login.codeLabel')} · ${challenge.sentTo}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            hint={challenge.devCode ? t('login.devCode', { code: challenge.devCode }) : undefined}
          />
          <Button type="submit" size="lg" block loading={verify.isPending} disabled={code.length !== 6}>
            {t('login.verify')}
          </Button>
        </form>
      )}
      <Button variant="ghost" className="mt-auto" onClick={() => void session.logout()}>
        {t('profile.logout')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ 2. 18+ and guidelines (S-01, A-06, CAT-06) */

function WelcomeStep() {
  const { t } = useTranslation();
  const toast = useToast();
  const [adult, setAdult] = useState(false);
  const accept = useMeMutation(() => api.acceptOnboarding());
  const rules = ['real', 'free', 'kind', 'private', 'emergency'] as const;
  return (
    <>
      <Title icon={<HeartHandshake size={24} />} title={t('onboarding.welcome.title')} body={t('onboarding.welcome.body')} />
      <ul className="flex flex-col gap-2.5">
        {rules.map((r) => (
          <li key={r} className="flex gap-3 rounded-2xl bg-white p-3.5 lip-card">
            <span className="hex flex h-8 w-7 shrink-0 items-center justify-center bg-brand text-white">
              <Check size={15} strokeWidth={3} />
            </span>
            <span>
              <span className="block text-[15px] font-bold">{t(`onboarding.rules.${r}.title`)}</span>
              <span className="block text-[13px] leading-relaxed text-ink-2">{t(`onboarding.rules.${r}.body`)}</span>
            </span>
          </li>
        ))}
      </ul>
      <label className="mt-5 flex items-start gap-3 rounded-2xl bg-tram-tint p-4">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} className="mt-0.5 size-5 accent-brand" />
        <span className="text-[14px] font-semibold text-tram-ink">{t('onboarding.welcome.adult')}</span>
      </label>
      <Button size="lg" block className="mt-6" disabled={!adult} loading={accept.isPending} onClick={() => accept.mutate(undefined, { onError: (e) => toast(errorMessage(e, t), 'error') })}>
        {t('onboarding.welcome.agree')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ 3. Profile (LANG-01) */

function ProfileStep() {
  const { t } = useTranslation();
  const toast = useToast();
  const me = useMe();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.data?.displayName ?? '');
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState<string[]>(['en']);
  const [newcomer, setNewcomer] = useState(false);
  const avatar = usePhotoUploads('avatar', 1);
  const toggle = (code: string) => setLanguages((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));
  return (
    <>
      <Title icon={<Sparkles size={24} />} title={t('onboarding.profile.title')} body={t('onboarding.profile.body')} />
      <div className="flex items-center gap-4">
        <label className="relative cursor-pointer">
          {avatar.photos[0] ? (
            <img src={avatar.photos[0].preview} alt="" className="hex h-[84px] w-[76px] object-cover" />
          ) : (
            <HexAvatar initials={name ? name.slice(0, 2).toUpperCase() : '?'} color="brand" size={76} />
          )}
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files && void avatar.add(e.target.files)} />
          <span className="mt-1 block text-center text-[12px] font-bold text-brand">{t('onboarding.profile.photo')}</span>
        </label>
        <TextField className="flex-1" label={t('onboarding.profile.name')} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="Zsófi K." />
      </div>
      <p className="mt-5 mb-2 text-[13px] font-bold">{t('onboarding.profile.languages')}</p>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            aria-pressed={languages.includes(l.code)}
            onClick={() => toggle(l.code)}
            className={cn('h-9 rounded-full px-3.5 text-[13px]', languages.includes(l.code) ? 'bg-sapphire font-bold text-white' : 'border-[1.5px] border-line-strong bg-white font-semibold')}
          >
            {l.name}
          </button>
        ))}
      </div>
      <TextArea className="mt-5" label={t('onboarding.profile.bio')} value={bio} maxLength={300} rows={3} onChange={(e) => setBio(e.target.value)} placeholder={t('onboarding.profile.bioPlaceholder')} />
      <label className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-white p-4 lip-card">
        <span>
          <span className="block text-[15px] font-bold">{t('onboarding.profile.newcomer')}</span>
          <span className="block text-[13px] text-ink-2">{t('onboarding.profile.newcomerHint')}</span>
        </span>
        <input type="checkbox" role="switch" checked={newcomer} onChange={(e) => setNewcomer(e.target.checked)} className="size-6 accent-brand" />
      </label>
      <Button
        size="lg"
        block
        className="mt-6"
        disabled={!name.trim() || !languages.length || avatar.uploading}
        loading={update.isPending}
        onClick={() =>
          update.mutate(
            { displayName: name.trim(), bio, languages, isNewcomer: newcomer, avatarMediaId: avatar.mediaIds[0] ?? null },
            { onError: (e) => toast(errorMessage(e, t), 'error') },
          )
        }
      >
        {t('common.next')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ 4. Home area (L-05) */

function AreaStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const set = useSetHomeArea();
  const [point, setPoint] = useState(DEFAULT_VIEW.center);
  const [flyTo, setFlyTo] = useState<{ center: { lat: number; lng: number }; key: number } | null>(null);
  return (
    <>
      <Title icon={<MapPin size={24} />} title={t('onboarding.area.title')} body={t('onboarding.area.body')} />
      <Suspense fallback={<div className="h-[260px] animate-pulse rounded-[20px] bg-[#ECEEE6]" />}>
        <LocationPicker point={point} precision="wider" kind="request" onChange={setPoint} flyTo={flyTo} />
      </Suspense>
      <Button
        variant="secondary"
        size="sm"
        className="mt-3 self-start"
        onClick={() =>
          navigator.geolocation?.getCurrentPosition(
            (pos) => setFlyTo({ center: { lat: pos.coords.latitude, lng: pos.coords.longitude }, key: Date.now() }),
            () => toast(t('create.location.noGps'), 'error'),
          )
        }
      >
        {t('create.location.useMine')}
      </Button>
      <p className="mt-4 flex gap-2 rounded-2xl bg-sapphire-tint p-3.5 text-[13px] leading-relaxed text-sapphire-ink">
        <ShieldCheck size={18} className="shrink-0" />
        {t('onboarding.area.privacy')}
      </p>
      <Button
        size="lg"
        block
        className="mt-6"
        loading={set.isPending}
        onClick={() => {
          onDone();
          set.mutate(latLngToCell(point.lat, point.lng, 7), { onError: (e) => toast(errorMessage(e, t), 'error') });
        }}
      >
        {t('onboarding.area.confirm')}
      </Button>
    </>
  );
}

/* ------------------------------------------------------------------ 5. Notifications (§8.1) */

function NotificationsStep() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ios = isIosBrowser();
  const done = () => void navigate({ to: '/problems', search: { view: 'map' } });
  async function turnOn() {
    setBusy(true);
    try {
      const r = await enablePush();
      if (r === 'enabled') {
        toast(t('onboarding.notifications.enabled'));
        done();
      } else toast(t(`onboarding.notifications.${r}`), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex justify-center">
        <Hexie size={96} mood="happy" />
      </div>
      <Title icon={<Bell size={24} />} title={t('onboarding.notifications.title')} body={t('onboarding.notifications.body')} />
      {ios ? (
        <div className="rounded-[20px] bg-white p-4 lip-card">
          <p className="text-[15px] font-bold">{t('onboarding.notifications.iosTitle')}</p>
          <ol className="mt-2 flex flex-col gap-2 text-[14px] text-ink-2">
            <li className="flex items-center gap-2">
              1. {t('onboarding.notifications.ios1')} <Share size={16} className="text-sapphire" />
            </li>
            <li>2. {t('onboarding.notifications.ios2')}</li>
            <li>3. {t('onboarding.notifications.ios3')}</li>
          </ol>
        </div>
      ) : (
        <Button size="lg" block loading={busy} onClick={() => void turnOn()} icon={<Bell size={19} />}>
          {t('onboarding.notifications.turnOn')}
        </Button>
      )}
      <Button variant="ghost" block className="mt-3" onClick={done}>
        {t('onboarding.notifications.later')}
      </Button>
    </>
  );
}
