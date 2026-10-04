import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Me } from '@helpin/contracts';
import { api } from '../../api';
import { useMe, useMeMutation } from '../../api/hooks';
import { errorMessage } from '../../lib/errors';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { useToast } from '../ui/Toast';
import { TextField } from '../ui/primitives';

/** Phone number → 6-digit code → verified. Used in the sheet below and in Settings. */
export function PhoneVerifyForm({ onVerified }: { onVerified?: (me: Me) => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; sentTo: string; devCode?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const verify = useMeMutation((v: { id: string; code: string }) => api.verifyPhone(v.id, v.code));
  const full = phone.trim().startsWith('+') ? phone.trim() : `+36${phone.replace(/\D/g, '')}`;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    try {
      const c = await api.requestPhoneCode(full);
      setChallenge({ id: c.challengeId, sentTo: c.sentTo, devCode: c.devCode });
      setCode('');
    } catch (err) {
      toast(errorMessage(err, t), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!challenge) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4">
        <TextField label={t('login.phoneLabel')} type="tel" inputMode="tel" autoComplete="tel" placeholder="+36 30 123 4567" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" size="lg" block loading={busy} disabled={phone.replace(/\D/g, '').length < 9}>
          {t('login.sendCode')}
        </Button>
      </form>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate(
          { id: challenge.id, code },
          {
            onSuccess: (me) => onVerified?.(me as Me),
            onError: (err) => {
              setCode('');
              toast(errorMessage(err, t), 'error');
            },
          },
        );
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
      <div className="flex justify-between text-[13px]">
        <button type="button" className="font-bold text-brand" disabled={busy} onClick={() => void send()}>
          {t('login.resend')}
        </button>
        <button type="button" className="font-bold text-ink-2" onClick={() => setChallenge(null)}>
          {t('login.change')}
        </button>
      </div>
    </form>
  );
}

/**
 * Raising a problem or offering help needs a verified phone; exploring doesn't. `gate(action)`
 * runs the action right away for verified people, or asks for the phone first and then runs it.
 */
export function usePhoneGate(): { gate: (action: () => void) => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const gate = (action: () => void) => {
    if (me.data?.phoneVerified) return action();
    pending.current = action;
    setOpen(true);
  };

  const sheet = (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) pending.current = null;
      }}
      title={t('phoneGate.title')}
      description={t('phoneGate.body')}
    >
      <div className="mb-4 flex gap-3 rounded-2xl bg-brand-tint p-3.5 text-[13px] leading-relaxed text-brand-ink">
        <ShieldCheck size={18} className="mt-0.5 shrink-0" />
        <span>{t('phoneGate.privacy')}</span>
      </div>
      <PhoneVerifyForm
        onVerified={() => {
          setOpen(false);
          const run = pending.current;
          pending.current = null;
          // Let the sheet close before the next step opens.
          if (run) setTimeout(run, 150);
        }}
      />
    </Sheet>
  );
  return { gate, sheet };
}
