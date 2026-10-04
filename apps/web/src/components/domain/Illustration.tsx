import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * Illustrated stand-ins for user photos in the demo (the mock API returns an illustration key
 * where the real API will return a media URL). Each scene is drawn on a 100×100 canvas.
 */
const SCENES: Record<string, ReactNode> = {
  sunset: (
    <>
      <rect width="100" height="62" fill="#FF8F4A" />
      <rect y="38" width="100" height="24" fill="#FFB067" />
      <circle cx="68" cy="44" r="13" fill="#FFE08A" />
      <path
        d="M0,62 L0,48 L8,48 L8,41 L13,41 L13,32 L16,27 L19,32 L19,41 L28,41 L28,36 L34,30 L40,36 L40,50 L48,50 L48,62 Z"
        fill="#7A2E1F"
      />
      <rect y="62" width="100" height="38" fill="#2352E0" />
      <rect x="58" y="67" width="20" height="2.5" rx="1" fill="#FFE08A" opacity="0.8" />
      <rect x="62" y="73" width="12" height="2" rx="1" fill="#FFE08A" opacity="0.6" />
      <rect x="65" y="79" width="6" height="2" rx="1" fill="#FFE08A" opacity="0.4" />
    </>
  ),
  tram: (
    <>
      <rect width="100" height="100" fill="#CFE3FF" />
      <circle cx="16" cy="40" r="12" fill="#3FBF7F" />
      <circle cx="88" cy="36" r="14" fill="#0A7A56" />
      <rect y="74" width="100" height="26" fill="#3A4640" />
      <rect y="84" width="100" height="2" fill="#9AA39D" />
      <line x1="40" y1="30" x2="52" y2="18" stroke="#0E1A14" strokeWidth="1.5" />
      <line x1="0" y1="18" x2="100" y2="18" stroke="#0E1A14" strokeWidth="1" />
      <rect x="10" y="36" width="80" height="38" rx="6" fill="#FFC531" />
      <rect x="10" y="62" width="80" height="5" fill="#E8452C" />
      <rect x="16" y="42" width="12" height="13" rx="2" fill="#E2F2FF" />
      <rect x="32" y="42" width="12" height="13" rx="2" fill="#E2F2FF" />
      <rect x="48" y="42" width="12" height="13" rx="2" fill="#E2F2FF" />
      <rect x="64" y="42" width="12" height="13" rx="2" fill="#E2F2FF" />
      <rect x="79" y="42" width="7" height="20" rx="2" fill="#E2F2FF" />
      <circle cx="24" cy="75" r="4" fill="#0E1A14" />
      <circle cx="76" cy="75" r="4" fill="#0E1A14" />
      <text
        x="20"
        y="40"
        fontSize="5"
        fontFamily="Figtree Variable, sans-serif"
        fontWeight="800"
        fill="#4D3600"
      >
        4 · 6
      </text>
    </>
  ),
  cleanup: (
    <>
      <rect width="100" height="100" fill="#9FD6BC" />
      <ellipse cx="50" cy="56" rx="38" ry="20" fill="#4F86E8" />
      <ellipse cx="44" cy="52" rx="16" ry="5" fill="#8DB4F5" opacity="0.7" />
      <circle cx="12" cy="22" r="13" fill="#0A7A56" />
      <circle cx="30" cy="14" r="10" fill="#3FBF7F" />
      <circle cx="86" cy="20" r="14" fill="#0A7A56" />
      <rect x="70" y="78" width="10" height="13" rx="3" fill="#0E1A14" />
      <rect x="73" y="76" width="4" height="3" fill="#FFC531" />
      <rect x="83" y="80" width="9" height="11" rx="3" fill="#0E1A14" />
      <rect x="85.5" y="78" width="4" height="3" fill="#FFC531" />
      <rect x="14" y="82" width="22" height="9" rx="4" fill="#FFFFFF" />
      <text
        x="17"
        y="89"
        fontSize="6"
        fontFamily="Figtree Variable, sans-serif"
        fontWeight="800"
        fill="#0A7A56"
      >
        +14
      </text>
    </>
  ),
  picnic: (
    <>
      <rect width="100" height="100" fill="#3FBF7F" />
      <g transform="rotate(-12 50 55)">
        <rect x="18" y="28" width="64" height="54" fill="#FFFFFF" />
        <rect x="18" y="28" width="16" height="13.5" fill="#E8452C" />
        <rect x="50" y="28" width="16" height="13.5" fill="#E8452C" />
        <rect x="34" y="41.5" width="16" height="13.5" fill="#E8452C" />
        <rect x="66" y="41.5" width="16" height="13.5" fill="#E8452C" />
        <rect x="18" y="55" width="16" height="13.5" fill="#E8452C" />
        <rect x="50" y="55" width="16" height="13.5" fill="#E8452C" />
        <rect x="34" y="68.5" width="16" height="13.5" fill="#E8452C" />
        <rect x="66" y="68.5" width="16" height="13.5" fill="#E8452C" />
      </g>
      <circle cx="48" cy="50" r="9" fill="#F28C00" />
      <circle cx="62" cy="58" r="6" fill="#FFC531" />
    </>
  ),
  bridge: (
    <>
      <rect width="100" height="100" fill="#0B1E3F" />
      <circle cx="80" cy="18" r="6" fill="#FFE9A8" />
      <rect y="66" width="100" height="34" fill="#132E5E" />
      <path d="M0,58 Q25,30 50,58 Q75,30 100,58" stroke="#5FA88A" strokeWidth="3" fill="none" />
      <rect y="57" width="100" height="4" fill="#5FA88A" />
      <circle cx="12" cy="54" r="1.8" fill="#FFC531" />
      <circle cx="38" cy="54" r="1.8" fill="#FFC531" />
      <circle cx="62" cy="54" r="1.8" fill="#FFC531" />
      <circle cx="88" cy="54" r="1.8" fill="#FFC531" />
      <rect x="10" y="70" width="4" height="12" fill="#FFC531" opacity="0.35" />
      <rect x="36" y="70" width="4" height="14" fill="#FFC531" opacity="0.35" />
      <rect x="60" y="70" width="4" height="10" fill="#FFC531" opacity="0.35" />
      <rect x="86" y="70" width="4" height="13" fill="#FFC531" opacity="0.35" />
    </>
  ),
  dog: (
    <>
      <rect width="100" height="100" fill="#FFEACC" />
      <ellipse cx="28" cy="40" rx="10" ry="18" fill="#7A4A26" transform="rotate(-20 28 40)" />
      <ellipse cx="72" cy="40" rx="10" ry="18" fill="#7A4A26" transform="rotate(20 72 40)" />
      <circle cx="50" cy="54" r="26" fill="#C98B4F" />
      <ellipse cx="50" cy="66" rx="14" ry="10" fill="#F2D3AE" />
      <circle cx="40" cy="50" r="3.4" fill="#0E1A14" />
      <circle cx="60" cy="50" r="3.4" fill="#0E1A14" />
      <ellipse cx="50" cy="61" rx="5" ry="3.5" fill="#0E1A14" />
      <path
        d="M45,68 Q50,73 55,68"
        stroke="#0E1A14"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="34" y="78" width="32" height="6" rx="3" fill="#E8452C" />
      <circle cx="50" cy="86" r="3.5" fill="#FFC531" />
    </>
  ),
  langos: (
    <>
      <rect width="100" height="100" fill="#E8452C" />
      <path
        d="M0,0 L20,0 L0,20 Z M40,0 L60,0 L0,60 L0,40 Z M80,0 L100,0 L0,100 L0,80 Z"
        fill="#FFFFFF"
        opacity="0.08"
      />
      <ellipse cx="50" cy="56" rx="36" ry="30" fill="#FFFFFF" />
      <path
        d="M24,54 C22,38 38,32 50,34 C64,32 80,40 76,56 C78,70 62,78 50,76 C36,78 22,70 24,54 Z"
        fill="#F2B54A"
      />
      <path
        d="M34,48 C42,42 56,44 64,50 C58,56 46,60 36,56"
        stroke="#FFF6E0"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="44" cy="60" r="2" fill="#F28C00" />
      <circle cx="58" cy="62" r="2" fill="#F28C00" />
    </>
  ),
  poster: (
    <>
      <rect width="100" height="100" fill="#0A7A56" />
      <polygon points="82,-6 102,5.5 102,28.5 82,40 62,28.5 62,5.5" fill="#FFC531" />
      <polygon points="14,74 26,81 26,95 14,102 2,95 2,81" fill="#FFFFFF" opacity="0.18" />
      <text
        x="10"
        y="54"
        fontSize="15"
        fontFamily="Bricolage Grotesque Variable, sans-serif"
        fontWeight="800"
        fill="#FFFFFF"
      >
        Welcome
      </text>
      <text
        x="10"
        y="70"
        fontSize="15"
        fontFamily="Bricolage Grotesque Variable, sans-serif"
        fontWeight="800"
        fill="#FFC531"
      >
        picnic
      </text>
      <text
        x="10"
        y="84"
        fontSize="7"
        fontFamily="Figtree Variable, sans-serif"
        fontWeight="700"
        fill="#DCF2E7"
      >
        Sat · Bikás park
      </text>
    </>
  ),
  drain: (
    <>
      <rect width="100" height="100" fill="#9AA39D" />
      <rect y="60" width="100" height="40" fill="#6F7A73" />
      <rect x="30" y="64" width="40" height="22" rx="3" fill="#3A4640" />
      <line x1="36" y1="64" x2="36" y2="86" stroke="#9AA39D" strokeWidth="2" />
      <line x1="44" y1="64" x2="44" y2="86" stroke="#9AA39D" strokeWidth="2" />
      <line x1="52" y1="64" x2="52" y2="86" stroke="#9AA39D" strokeWidth="2" />
      <line x1="60" y1="64" x2="60" y2="86" stroke="#9AA39D" strokeWidth="2" />
      <circle cx="40" cy="58" r="7" fill="#C98B4F" />
      <circle cx="56" cy="56" r="6" fill="#A86B3A" />
    </>
  ),
  bench: (
    <>
      <rect width="100" height="100" fill="#BFE5D2" />
      <rect y="70" width="100" height="30" fill="#3FBF7F" />
      <rect x="16" y="50" width="30" height="6" rx="2" fill="#7A4A26" transform="rotate(8 31 53)" />
      <rect
        x="52"
        y="54"
        width="32"
        height="6"
        rx="2"
        fill="#7A4A26"
        transform="rotate(-14 68 57)"
      />
      <rect x="22" y="56" width="4" height="16" fill="#3A4640" />
      <rect x="76" y="58" width="4" height="14" fill="#3A4640" />
    </>
  ),
};

export const ILLUSTRATION_KEYS = [...Object.keys(SCENES), 'thanks'];

export function Illustration({
  name,
  className,
  thanksTo,
  thanksFrom,
}: {
  name: string;
  className?: string;
  /** For thank-you cards: who is thanked and by whom. */
  thanksTo?: string;
  thanksFrom?: string;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={cn('block size-full', className)}
      aria-hidden
    >
      {name === 'thanks' ? (
        <ThanksScene to={thanksTo ?? 'neighbour'} from={thanksFrom} />
      ) : (
        (SCENES[name] ?? <rect width="100" height="100" fill="#DCF2E7" />)
      )}
    </svg>
  );
}

function ThanksScene({ to, from }: { to: string; from?: string }) {
  const first = to.split(' ')[0] ?? to;
  return (
    <>
      <rect width="100" height="100" fill="#FFC531" />
      <polygon points="80,4 96,13 96,31 80,40 64,31 64,13" fill="#FFFFFF" opacity="0.35" />
      <text
        x="12"
        y="38"
        fontSize="30"
        fontFamily="Bricolage Grotesque Variable, sans-serif"
        fontWeight="800"
        fill="#0E1A14"
      >
        “
      </text>
      <text
        x="12"
        y="60"
        fontSize="17"
        fontFamily="Bricolage Grotesque Variable, sans-serif"
        fontWeight="800"
        fill="#0E1A14"
      >
        Köszi,
      </text>
      <text
        x="12"
        y="77"
        fontSize="17"
        fontFamily="Bricolage Grotesque Variable, sans-serif"
        fontWeight="800"
        fill="#0E1A14"
      >
        {first}!
      </text>
      {from && (
        <text
          x="12"
          y="91"
          fontSize="7"
          fontFamily="Figtree Variable, sans-serif"
          fontWeight="700"
          fill="#4D3600"
        >
          from {from}
        </text>
      )}
    </>
  );
}
