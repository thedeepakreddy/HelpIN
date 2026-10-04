import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BadgeCheck, Download, KeyRound, LogOut, MapPin, Shield, Smartphone, Trash2, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@helpin/config';
import type { AlertPrefs, Me } from '@helpin/contracts';
import { latLngToCell } from 'h3-js';
import { cellCenter } from '@helpin/geo';
import { api } from '../../api';
import { qk, useBlocks, useMe, useMeMutation, useSession, useSetAlertPrefs, useSetHomeArea, useUpdateProfile } from '../../api/hooks';
import { Photo, usePhotoUploads } from '../../components/domain/media';
import { PhoneVerifyForm } from '../../components/domain/PhoneVerify';
import { Button, IconButton } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { useToast } from '../../components/ui/Toast';
import { HexAvatar, Segmented, Skeleton, TextArea, TextField } from '../../components/ui/primitives';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/errors';
import { disablePush, enablePush } from '../../lib/push';

const LocationPicker = lazy(() => import('../create/LocationPicker').then((m) => ({ default: m.LocationPicker })));

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mt-5 rounded-[22px] bg-white p-4 lip-card">
      <h2 className="mb-3 flex items-center gap-2 font-display text-[18px] font-bold">
        <span className="text-brand">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  if (!me.data) return <Skeleton className="m-4 h-72" />;
  return (
    <div className="mx-auto max-w-xl px-4 pt-[max(12px,env(safe-area-inset-top))] pb-10">
      <header className="flex items-center gap-1">
        <IconButton label={t('common.back')} className="-ml-2" onClick={() => router.history.back()}>
          <ArrowLeft size={22} />
        </IconButton>
        <h1 className="font-display text-[28px] font-extrabold tracking-tight">{t('settings.title')}</h1>
      </header>
      <ProfileSection me={me.data} />
      <AreaSection me={me.data} />
      <NotificationSection me={me.data} />
      <PrivacySection />
      <AccountSection me={me.data} />
      <p className="mt-6 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[12px] text-muted">
        {(['terms', 'privacy', 'guidelines', 'imprint'] as const).map((p) => (
          <Link key={p} to="/legal/$page" params={{ page: p }} className="text-muted">
            {t(`legal.${p}`)}
          </Link>
        ))}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Profile (LANG-01) */

function ProfileSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateProfile();
  const [name, setName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio);
  const [languages, setLanguages] = useState(me.languages);
  const [newcomer, setNewcomer] = useState(me.isNewcomer);
  const avatar = usePhotoUploads('avatar', 1);
  const toggle = (code: string) => setLanguages((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));
  return (
    <Section icon={<UserRound size={20} />} title={t('settings.profile')}>
      <div className="flex items-center gap-4">
        <label className="cursor-pointer text-center">
          {avatar.photos[0] ? (
            <img src={avatar.photos[0].preview} alt="" className="hex h-[70px] w-16 object-cover" />
          ) : me.avatar ? (
            <Photo media={me.avatar} size="thumbUrl" alt="" className="hex h-[70px] w-16" />
          ) : (
            <HexAvatar initials={me.initials} color={me.color} size={64} />
          )}
          <span className="mt-1 block text-[12px] font-bold text-brand">{t('onboarding.profile.photo')}</span>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files && void avatar.add(e.target.files)} />
        </label>
        <TextField className="flex-1" label={t('onboarding.profile.name')} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
      </div>
      <TextArea className="mt-4" label={t('onboarding.profile.bio')} value={bio} maxLength={300} rows={3} onChange={(e) => setBio(e.target.value)} />
      <p className="mt-4 mb-2 text-[13px] font-bold">{t('onboarding.profile.languages')}</p>
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
      <label className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold">{t('onboarding.profile.newcomer')}</span>
        <input type="checkbox" role="switch" checked={newcomer} onChange={(e) => setNewcomer(e.target.checked)} className="size-6 accent-brand" />
      </label>
      <Button
        className="mt-4"
        block
        disabled={!name.trim() || !languages.length || avatar.uploading}
        loading={update.isPending}
        onClick={() =>
          update.mutate(
            { displayName: name.trim(), bio, languages, isNewcomer: newcomer, ...(avatar.mediaIds[0] ? { avatarMediaId: avatar.mediaIds[0] } : {}) },
            { onSuccess: () => toast(t('settings.saved')), onError: (e) => toast(errorMessage(e, t), 'error') },
          )
        }
      >
        {t('settings.save')}
      </Button>
    </Section>
  );
}

/* ------------------------------------------------------------------ Home area (L-05) */

function AreaSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const set = useSetHomeArea();
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState(me.homeCell ? cellCenter(me.homeCell) : { lat: 47.4738, lng: 19.0515 });
  return (
    <Section icon={<MapPin size={20} />} title={t('settings.area')}>
      <p className="text-[14px] text-ink-2">{me.homeDistrict ? t('settings.areaCurrent', { district: me.homeDistrict }) : t('settings.areaNone')}</p>
      <p className="mt-1 text-[12px] text-muted">{t('onboarding.area.privacy')}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        {t('settings.changeArea')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('settings.area')}
        footer={
          <Button
            size="lg"
            block
            loading={set.isPending}
            onClick={() =>
              set.mutate(latLngToCell(point.lat, point.lng, 7), {
                onSuccess: () => {
                  toast(t('settings.saved'));
                  setOpen(false);
                },
                onError: (e) => toast(errorMessage(e, t), 'error'),
              })
            }
          >
            {t('onboarding.area.confirm')}
          </Button>
        }
      >
        <Suspense fallback={<div className="h-[260px] animate-pulse rounded-[20px] bg-[#ECEEE6]" />}>
          <LocationPicker point={point} precision="wider" kind="request" onChange={setPoint} flyTo={null} />
        </Suspense>
      </Sheet>
    </Section>
  );
}

/* ------------------------------------------------------------------ Notifications (§8) */

function NotificationSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const save = useSetAlertPrefs();
  const [prefs, setPrefs] = useState<AlertPrefs>(me.alertPrefs);
  const [busy, setBusy] = useState(false);
  const patch = (p: Partial<AlertPrefs>) => setPrefs((x) => ({ ...x, ...p }));

  async function togglePush() {
    setBusy(true);
    try {
      if (me.pushSubscribed) {
        await disablePush();
        toast(t('settings.pushOff'));
      } else {
        const r = await enablePush();
        toast(r === 'enabled' ? t('onboarding.notifications.enabled') : t(`onboarding.notifications.${r}`), r === 'enabled' ? 'success' : 'error');
      }
      void qc.invalidateQueries({ queryKey: qk.me });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section icon={<Bell size={20} />} title={t('settings.notifications')}>
      <div className="flex items-center justify-between gap-3">
        <span>
          <span className="block text-[15px] font-bold">{t('settings.push')}</span>
          <span className="block text-[13px] text-ink-2">{me.pushSubscribed ? t('settings.pushOnHint') : t('settings.pushOffHint')}</span>
        </span>
        <Button size="sm" variant={me.pushSubscribed ? 'secondary' : 'primary'} loading={busy} onClick={() => void togglePush()}>
          {me.pushSubscribed ? t('settings.turnOff') : t('settings.turnOn')}
        </Button>
      </div>
      {me.pushSubscribed && (
        <button type="button" className="mt-2 text-[13px] font-bold text-brand" onClick={() => void api.testPush().then(() => toast(t('settings.testSent')))}>
          {t('settings.testPush')}
        </button>
      )}
      <hr className="my-4 border-line" />
      <label className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-bold">{t('settings.nearbyAlerts')}</span>
        <input type="checkbox" role="switch" checked={prefs.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="size-6 accent-brand" />
      </label>
      {prefs.enabled && (
        <>
          <p className="mt-4 mb-1.5 text-[13px] font-bold">{t('settings.ring')}</p>
          <Segmented
            label={t('settings.ring')}
            value={String(prefs.ring) as '0' | '1' | '2'}
            onChange={(v) => patch({ ring: Number(v) })}
            options={[
              { value: '0', label: t('settings.ring0') },
              { value: '1', label: t('settings.ring1') },
              { value: '2', label: t('settings.ring2') },
            ]}
          />
          <p className="mt-4 mb-1.5 text-[13px] font-bold">{t('settings.minUrgency')}</p>
          <Segmented
            label={t('settings.minUrgency')}
            value={prefs.minUrgency}
            onChange={(v) => patch({ minUrgency: v })}
            options={(['basic', 'medium', 'serious'] as const).map((u) => ({ value: u, label: t(`urgency.${u}`) }))}
          />
          <TextField
            className="mt-4"
            label={t('settings.dailyCap')}
            type="number"
            min={0}
            max={50}
            value={String(prefs.dailyCap)}
            onChange={(e) => patch({ dailyCap: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
            hint={t('settings.dailyCapHint')}
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <TextField label={t('settings.quietStart')} type="time" value={prefs.quietStart ?? ''} onChange={(e) => patch({ quietStart: e.target.value || null })} />
            <TextField label={t('settings.quietEnd')} type="time" value={prefs.quietEnd ?? ''} onChange={(e) => patch({ quietEnd: e.target.value || null })} />
          </div>
          <label className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[14px]">{t('settings.seriousInQuiet')}</span>
            <input type="checkbox" checked={prefs.seriousInQuiet} onChange={(e) => patch({ seriousInQuiet: e.target.checked })} className="size-5 accent-brand" />
          </label>
        </>
      )}
      <label className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[14px]">{t('settings.emailDigest')}</span>
        <input type="checkbox" checked={prefs.emailDigest} onChange={(e) => patch({ emailDigest: e.target.checked })} className="size-5 accent-brand" />
      </label>
      <Button
        className="mt-4"
        block
        loading={save.isPending}
        onClick={() => save.mutate(prefs, { onSuccess: () => toast(t('settings.saved')), onError: (e) => toast(errorMessage(e, t), 'error') })}
      >
        {t('settings.save')}
      </Button>
    </Section>
  );
}

/* ------------------------------------------------------------------ Blocks (S-03) */

function PrivacySection() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const blocks = useBlocks();
  return (
    <Section icon={<Shield size={20} />} title={t('settings.blocked')}>
      {!blocks.data?.length ? (
        <p className="text-[14px] text-ink-2">{t('settings.noBlocks')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocks.data.map((b) => (
            <li key={b.userId} className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-semibold">{b.displayName}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  try {
                    await api.unblock(b.userId);
                    void qc.invalidateQueries();
                  } catch (e) {
                    toast(errorMessage(e, t), 'error');
                  }
                }}
              >
                {t('settings.unblock')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ Account (S-07, S-08) */

function AccountSection({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const session = useSession();
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const savePassword = useMeMutation((v: { password: string; current?: string }) => api.setPassword(v.password, v.current));

  async function exportData() {
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'helpin-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <Section icon={<UserRound size={20} />} title={t('settings.account')}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-muted">{t('settings.phone')}</dt>
        <dd className="flex items-center gap-1.5 font-semibold">
          {me.phoneVerified ? (
            <>
              {me.phoneMasked}
              <BadgeCheck size={16} className="text-brand" aria-label={t('settings.phoneVerified')} />
            </>
          ) : (
            <span className="text-ink-2">{t('settings.phoneNotVerified')}</span>
          )}
        </dd>
        <dt className="text-muted">{t('settings.email')}</dt>
        <dd className="font-semibold break-all">{me.email ?? '—'}</dd>
      </dl>
      <div className="mt-4 flex flex-col gap-2">
        {!me.phoneVerified && (
          <Button block icon={<Smartphone size={18} />} onClick={() => setPhoneOpen(true)}>
            {t('settings.verifyPhone')}
          </Button>
        )}
        {me.email && (
          <Button variant="secondary" block icon={<KeyRound size={18} />} onClick={() => setPasswordOpen(true)}>
            {me.hasPassword ? t('settings.changePassword') : t('settings.setPassword')}
          </Button>
        )}
        <Button variant="secondary" block icon={<Download size={18} />} onClick={() => void exportData()}>
          {t('settings.export')}
        </Button>
        <Button variant="secondary" block icon={<LogOut size={18} />} onClick={() => void session.logout()}>
          {t('profile.logout')}
        </Button>
        <Button variant="ghost" block icon={<Trash2 size={18} />} className="text-coral-ink" onClick={() => setConfirm(true)}>
          {t('settings.delete')}
        </Button>
      </div>
      <Sheet open={phoneOpen} onOpenChange={setPhoneOpen} title={t('phoneGate.title')} description={t('settings.verifyPhoneBody')}>
        <PhoneVerifyForm
          onVerified={() => {
            setPhoneOpen(false);
            toast(t('settings.phoneDone'));
          }}
        />
      </Sheet>
      <Sheet
        open={passwordOpen}
        onOpenChange={(o) => {
          setPasswordOpen(o);
          setCurrent('');
          setNext('');
        }}
        title={me.hasPassword ? t('settings.changePassword') : t('settings.setPassword')}
        description={me.hasPassword ? undefined : t('settings.setPasswordBody')}
      >
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            savePassword.mutate(
              { password: next, current: me.hasPassword ? current : undefined },
              {
                onSuccess: () => {
                  setPasswordOpen(false);
                  setCurrent('');
                  setNext('');
                  toast(t('settings.passwordSaved'));
                },
                onError: (err) => toast(errorMessage(err, t), 'error'),
              },
            );
          }}
        >
          {me.hasPassword && <TextField label={t('settings.currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}
          <TextField label={t('login.newPassword')} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint={t('login.passwordHint', { count: 8 })} />
          <Button type="submit" size="lg" block loading={savePassword.isPending} disabled={next.length < 8 || (me.hasPassword && !current)}>
            {t('settings.save')}
          </Button>
        </form>
      </Sheet>
      <Sheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('settings.deleteTitle')}
        description={t('settings.deleteBody')}
        footer={
          <Button
            size="lg"
            variant="danger"
            block
            disabled={typed !== 'DELETE'}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.deleteAccount();
              } catch (e) {
                toast(errorMessage(e, t), 'error');
                setBusy(false);
              }
            }}
          >
            {t('settings.deleteConfirm')}
          </Button>
        }
      >
        <TextField label={t('settings.deleteType')} value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
      </Sheet>
    </Section>
  );
}
