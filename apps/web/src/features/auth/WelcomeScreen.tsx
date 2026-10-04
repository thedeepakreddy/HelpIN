import { Link } from '@tanstack/react-router';
import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Hexies, Logo } from '../../components/domain/Hexies';
import { buttonClass } from '../../components/ui/Button';

function HeroPattern() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 390 480" preserveAspectRatio="xMidYMin slice" aria-hidden>
      <polygon points="330,-30 412,17 412,111 330,158 248,111 248,17" fill="none" stroke="#FFFFFF" strokeOpacity="0.09" strokeWidth="2" />
      <polygon points="352,120 396,145 396,195 352,220 308,195 308,145" fill="#FFFFFF" fillOpacity="0.05" />
      <polygon points="-10,250 40,279 40,337 -10,366 -60,337 -60,279" fill="none" stroke="#FFFFFF" strokeOpacity="0.09" strokeWidth="2" />
      <polygon points="352,262 374,274.7 374,300 352,312.7 330,300 330,274.7" fill="#FFC531" fillOpacity="0.9" />
    </svg>
  );
}

const PILLARS = [
  { key: 'anyLanguage', color: 'bg-brand' },
  { key: 'communities', color: 'bg-tram' },
  { key: 'areaNotAddress', color: 'bg-sapphire' },
] as const;

export function WelcomeScreen() {
  const { t } = useTranslation();
  return (
    <div className="min-h-dvh bg-brand md:flex md:items-center md:justify-center md:p-8">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-[440px] flex-col overflow-hidden bg-brand md:min-h-[820px] md:rounded-[36px] md:shadow-2xl">
        <HeroPattern />
        <header className="relative flex items-center justify-between px-6 pt-6">
          <Logo onDark />
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[13px] font-bold text-white">
            <MapPin size={14} strokeWidth={2.4} />
            Budapest
          </span>
        </header>

        <h1 className="relative mx-6 mt-8 font-display text-[clamp(44px,13vw,56px)] leading-[0.94] font-extrabold tracking-[-0.04em] text-white">
          {t('welcome.line1')}
          <br />
          {t('welcome.line2')}
          <br />
          <span className="text-tram">{t('welcome.line3')}</span>
        </h1>

        <div className="relative mt-2 -mb-6 px-0">
          <Hexies look={{ x: 0.3, y: -0.4 }} />
        </div>

        <section className="relative mt-auto flex flex-1 flex-col rounded-t-[30px] bg-paper px-6 pt-7 pb-6">
          <p className="text-[17px] leading-relaxed font-medium text-ink-2">
            {t('welcome.pitch')} <strong className="font-bold text-ink">{t('welcome.alwaysFree')}</strong>
          </p>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[13px] font-bold text-ink-2">
            {PILLARS.map((p) => (
              <li key={p.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={`hex h-2.5 w-[9px] ${p.color}`} />
                {t(`welcome.${p.key}`)}
              </li>
            ))}
          </ul>
          <div className="mt-auto flex flex-col gap-3 pt-8">
            <Link to="/login" search={{ mode: 'signup' }} className={buttonClass('primary', 'lg', true)}>
              {t('welcome.getStarted')}
            </Link>
            <Link to="/login" search={{ mode: 'login' }} className={buttonClass('secondary', 'md', true)}>
              {t('welcome.haveAccount')}
            </Link>
            <p className="mt-0.5 flex justify-center gap-1.5 text-center text-[12px] text-muted">
              <span>{t('welcome.adultOnly')}</span>·
              <Link to="/legal/$page" params={{ page: 'terms' }} className="text-muted">
                {t('legal.terms')}
              </Link>
              ·
              <Link to="/legal/$page" params={{ page: 'privacy' }} className="text-muted">
                {t('legal.privacy')}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
