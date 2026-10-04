import {
  Car,
  Compass,
  Construction,
  Droplet,
  Droplets,
  Ellipsis,
  FileText,
  Flame,
  Footprints,
  Hand,
  HeartHandshake,
  HeartPulse,
  Languages,
  Lamp,
  Lightbulb,
  PawPrint,
  Repeat,
  Search,
  ShieldAlert,
  Stethoscope,
  TrafficCone,
  Trash2,
  TreeDeciduous,
  Trees,
  TriangleAlert,
  Users,
  Waves,
  Wifi,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { findCategory, languageName } from '@helpin/config';
import type { Asker, ProblemCard as ProblemCardData } from '@helpin/contracts';
import { cn } from '../../lib/cn';
import { relativeTime } from '../../lib/time';
import { AnonymousAvatar, Chip, HexAvatar, HexTile, type ChipTone } from '../ui/primitives';

/* ------------------------------------------------------------------ Categories */

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  need_a_hand: Hand,
  lost_found: Search,
  borrow_lend: Repeat,
  elderly_support: HeartHandshake,
  pets_animals: PawPrint,
  vehicle_help: Car,
  advice: Lightbulb,
  language_translation: Languages,
  paperwork_offices: FileText,
  finding_services: Stethoscope,
  settling_in: Compass,
  garbage: Trash2,
  water_bodies: Waves,
  parks: Trees,
  trees: TreeDeciduous,
  air_noise: Wind,
  water_wastage: Droplets,
  potholes: Construction,
  streetlights: Lamp,
  drainage: Droplets,
  footpaths: Footprints,
  traffic_parking: TrafficCone,
  water_supply: Droplet,
  power_cuts: Zap,
  gas: Flame,
  network: Wifi,
  safety_concern: ShieldAlert,
  personal_support: HeartPulse,
  other: Ellipsis,
};

/** Colour family per category group — newcomers sapphire, environment green, roads amber… */
export const GROUP_TONE: Record<string, string> = {
  everyday: 'brand',
  newcomers: 'sapphire',
  environment: 'mint',
  roads: 'amber',
  utilities: 'sapphire',
  safety: 'coral',
  other: 'tram',
};

export function categoryIcon(categoryId: string): LucideIcon {
  return CATEGORY_ICONS[categoryId] ?? Ellipsis;
}

export function categoryTone(categoryId: string): string {
  try {
    return GROUP_TONE[findCategory(categoryId).group.id] ?? 'brand';
  } catch {
    return 'brand';
  }
}

/** Renders the icon for a category (a component, so hooks lint can see it is static). */
export function CategoryIcon({ categoryId, size, strokeWidth }: { categoryId: string; size: number; strokeWidth?: number }) {
  return createElement(categoryIcon(categoryId), { size, strokeWidth });
}

export function CategoryHex({
  categoryId,
  size = 44,
  urgent = false,
}: {
  categoryId: string;
  size?: number;
  urgent?: boolean;
}) {
  return (
    <HexTile color={urgent ? 'coral' : categoryTone(categoryId)} size={size}>
      <CategoryIcon categoryId={categoryId} size={Math.round(size * 0.48)} strokeWidth={2.1} />
    </HexTile>
  );
}

/* ------------------------------------------------------------------ Badges */

const URGENCY_TONE: Record<string, ChipTone> = { basic: 'neutral', medium: 'amber', serious: 'coral' };

export function UrgencyBadge({ urgency, size }: { urgency: string; size?: 'xs' | 'sm' }) {
  const { t } = useTranslation();
  return (
    <Chip tone={URGENCY_TONE[urgency] ?? 'neutral'} size={size} icon={urgency === 'serious' ? <TriangleAlert size={12} strokeWidth={2.6} /> : undefined}>
      {t(`urgency.${urgency}`)}
    </Chip>
  );
}

export function KindBadge({ kind, size }: { kind: string; size?: 'xs' | 'sm' }) {
  const { t } = useTranslation();
  if (kind !== 'issue') return null;
  return (
    <Chip tone="neutral" size={size} icon={<Users size={12} strokeWidth={2.4} />}>
      {t('problem.community')}
    </Chip>
  );
}

/** "Hungarian → English" for a language need such as "hu>en". */
export function languagePair(need: string): { from: string; to: string } {
  const [from = '', to = ''] = need.split('>');
  return { from, to };
}

export function LanguageBadge({ need, size }: { need: string; size?: 'xs' | 'sm' }) {
  const { from, to } = languagePair(need);
  return (
    <Chip tone="sapphire" size={size} icon={<Languages size={12} strokeWidth={2.4} />}>
      {languageName(from)} → {languageName(to)}
    </Chip>
  );
}

export function speaksNeededLanguage(need: string | null, myLanguages: string[] | undefined): boolean {
  if (!need || !myLanguages) return false;
  const { from, to } = languagePair(need);
  return myLanguages.includes(from) && myLanguages.includes(to);
}

const PROGRESS_TONE: Record<string, ChipTone> = {
  still_need_help: 'amber',
  making_progress: 'brand',
  partly_solved: 'brand',
  need_changed: 'sapphire',
  note: 'neutral',
};

export function ProgressChip({ status, size }: { status: string; size?: 'xs' | 'sm' }) {
  const { t } = useTranslation();
  return (
    <Chip tone={PROGRESS_TONE[status] ?? 'neutral'} size={size}>
      {t(`progress.${status}`)}
    </Chip>
  );
}

const STATUS_TONE: Record<string, ChipTone> = {
  open: 'amber',
  solved: 'solidBrand',
  abandoned: 'neutral',
  expired: 'neutral',
  withdrawn: 'neutral',
  removed: 'coral',
};

export function StatusBadge({ status, size }: { status: string; size?: 'xs' | 'sm' }) {
  const { t } = useTranslation();
  return (
    <Chip tone={STATUS_TONE[status] ?? 'neutral'} size={size}>
      {t(`status.${status}`)}
    </Chip>
  );
}

/* ------------------------------------------------------------------ Asker */

export function AskerAvatar({ asker, size = 40 }: { asker: Asker; size?: number }) {
  if (asker.anonymous) return <AnonymousAvatar size={size} />;
  return <HexAvatar initials={asker.user.initials} color={asker.user.color} photo={asker.user.avatar} size={size} />;
}

export function askerName(asker: Asker, anonymousLabel: string): string {
  return asker.anonymous ? anonymousLabel : asker.user.displayName;
}

/* ------------------------------------------------------------------ Card */

export function ProblemCard({
  problem,
  distance,
  myLanguages,
  className,
}: {
  problem: ProblemCardData;
  distance?: string;
  myLanguages?: string[];
  className?: string;
}) {
  const { t } = useTranslation();
  const serious = problem.urgency === 'serious';
  const meta = [
    distance,
    problem.kind === 'issue'
      ? t('problem.affected', { count: problem.affectedCount })
      : problem.helpingCount > 0
        ? t('problem.helping', { count: problem.helpingCount })
        : problem.offersCount > 0
          ? t('problem.offers', { count: problem.offersCount })
          : t('problem.noHelpYet'),
    t('problem.updated', { when: relativeTime(problem.lastActivityAt) }),
  ].filter(Boolean);

  return (
    <Link
      to="/p/$problemId"
      params={{ problemId: problem.id }}
      className={cn(
        'group flex items-start gap-3 rounded-[18px] bg-white p-3 text-ink no-underline lip-card transition-transform active:scale-[0.99]',
        className,
      )}
    >
      <CategoryHex categoryId={problem.categoryId} urgent={serious} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-bold group-hover:text-brand-ink">{problem.title}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <UrgencyBadge urgency={problem.urgency} />
          <KindBadge kind={problem.kind} />
          {problem.languageNeeded && <LanguageBadge need={problem.languageNeeded} />}
          {speaksNeededLanguage(problem.languageNeeded, myLanguages) && <Chip tone="brand">{t('problem.speaksYourLanguage')}</Chip>}
          {problem.latestProgress && problem.latestProgress !== 'note' && <ProgressChip status={problem.latestProgress} />}
        </div>
        <p className="mt-1.5 truncate text-[12px] text-ink-2">
          {problem.area.locality} · {meta.join(' · ')}
        </p>
      </div>
    </Link>
  );
}
