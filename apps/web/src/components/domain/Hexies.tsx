import { cn } from '../../lib/cn';

export type HexieMood = 'neutral' | 'happy' | 'sad' | 'sleepy';

/**
 * The Hexies: three hexagon friends who guide sign-up (docs/06-ui-spec.md §4.3).
 * `look` steers the pupils (-1…1 on each axis); `covering` puts their hands over their mouths
 * while a code is typed ("we're not peeking").
 */
export interface HexiesProps {
  mood?: HexieMood;
  look?: { x: number; y: number };
  covering?: boolean;
  className?: string;
}

interface Spec {
  eyes: [[number, number], [number, number]];
  r: number;
  range: number;
  mouth: { cx: number; y: number; w: number };
  hands: [[number, number], [number, number]];
  delay: string;
}

const LEAD: Spec = { eyes: [[175, 140], [215, 140]], r: 11, range: 5, mouth: { cx: 195, y: 168, w: 14 }, hands: [[39, -46], [-39, -46]], delay: '' };
const MINT: Spec = { eyes: [[286, 168], [314, 168]], r: 8.5, range: 4, mouth: { cx: 300, y: 190, w: 9 }, hands: [[29, -34], [-29, -34]], delay: 'hx-d1' };
const BLUE: Spec = { eyes: [[77, 176], [99, 176]], r: 7, range: 3.2, mouth: { cx: 88, y: 196, w: 7 }, hands: [[23, -30], [-23, -30]], delay: 'hx-d2' };

function face(spec: Spec, mood: HexieMood, look: { x: number; y: number }, covering: boolean) {
  const { r, range } = spec;
  const eye = ([x, y]: [number, number]) => ({
    x,
    y,
    px: x + look.x * range,
    py: y + look.y * range,
    happy: `M${x - r},${y + 2} Q${x},${y - r * 1.1} ${x + r},${y + 2}`,
    sleep: `M${x - r},${y + 1} Q${x},${y + r * 0.7} ${x + r},${y + 1}`,
  });
  const L = eye(spec.eyes[0]);
  const R = eye(spec.eyes[1]);
  const browL = `M${L.x - r},${L.y - r - 2} L${L.x + r * 0.7},${L.y - r - 8}`;
  const browR = `M${R.x - r * 0.7},${R.y - r - 8} L${R.x + r},${R.y - r - 2}`;
  const { cx, y, w } = spec.mouth;
  let mouth = `M${cx - w},${y} Q${cx},${y + w * 0.9} ${cx + w},${y}`;
  let mouthFill = 'none';
  if (mood === 'happy') {
    mouth = `M${cx - w * 1.1},${y - 2} Q${cx},${y + w * 1.7} ${cx + w * 1.1},${y - 2} Z`;
    mouthFill = '#0E1A14';
  } else if (mood === 'sad') {
    mouth = `M${cx - w * 0.8},${y + w * 0.6} Q${cx},${y - w * 0.2} ${cx + w * 0.8},${y + w * 0.6}`;
  } else if (mood === 'sleepy') {
    mouth = `M${cx - w * 0.5},${y + 3} L${cx + w * 0.5},${y + 3}`;
  } else if (covering) {
    mouth = `M${cx - w * 0.35},${y + 2} Q${cx},${y + w * 0.75} ${cx + w * 0.35},${y + 2} Q${cx},${y - w * 0.25} ${cx - w * 0.35},${y + 2} Z`;
    mouthFill = '#0E1A14';
  }
  const motion =
    mood === 'happy' ? `hx-jump ${spec.delay}` : mood === 'sad' || mood === 'sleepy' ? 'hx-droop' : `hx-breathe ${spec.delay}`;
  const hand = (i: 0 | 1) => (covering && mood === 'neutral' ? `translate(${spec.hands[i][0]}px, ${spec.hands[i][1]}px)` : 'translate(0px, 0px)');
  return { L, R, browL, browR, mouth, mouthFill, motion, handL: hand(0), handR: hand(1) };
}

const pupil = { transition: 'cx .2s ease, cy .2s ease' } as const;
const handMotion = (transform: string) => ({ transform, transition: 'transform .35s ease' });

function Eyes({ f, mood, r, stroke, pupilR }: { f: ReturnType<typeof face>; mood: HexieMood; r: number; stroke: number; pupilR: number }) {
  const open = mood === 'neutral' || mood === 'sad';
  return (
    <>
      {open && (
        <g className="hx-blink">
          <circle cx={f.L.x} cy={f.L.y} r={r} fill="#FFFFFF" />
          <circle cx={f.L.px} cy={f.L.py} r={pupilR} fill="#0E1A14" style={pupil} />
          <circle cx={f.R.x} cy={f.R.y} r={r} fill="#FFFFFF" />
          <circle cx={f.R.px} cy={f.R.py} r={pupilR} fill="#0E1A14" style={pupil} />
        </g>
      )}
      {mood === 'happy' && (
        <>
          <path d={f.L.happy} stroke="#0E1A14" strokeWidth={stroke} fill="none" strokeLinecap="round" />
          <path d={f.R.happy} stroke="#0E1A14" strokeWidth={stroke} fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'sleepy' && (
        <>
          <path d={f.L.sleep} stroke="#0E1A14" strokeWidth={stroke} fill="none" strokeLinecap="round" />
          <path d={f.R.sleep} stroke="#0E1A14" strokeWidth={stroke} fill="none" strokeLinecap="round" />
        </>
      )}
      {mood === 'sad' && (
        <>
          <path d={f.browL} stroke="#0E1A14" strokeWidth={stroke * 0.9} fill="none" strokeLinecap="round" />
          <path d={f.browR} stroke="#0E1A14" strokeWidth={stroke * 0.9} fill="none" strokeLinecap="round" />
        </>
      )}
      <path d={f.mouth} fill={f.mouthFill} stroke="#0E1A14" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

export function Hexies({ mood = 'neutral', look = { x: 0, y: 0 }, covering = false, className }: HexiesProps) {
  const a = face(LEAD, mood, look, covering);
  const b = face(MINT, mood, look, covering);
  const c = face(BLUE, mood, look, covering);
  return (
    <svg viewBox="0 52 390 190" className={cn('block w-full overflow-visible', className)} aria-hidden>
      <ellipse cx="195" cy="236" rx="230" ry="20" fill="#FFFFFF" fillOpacity="0.12" />

      {/* Sapphire — the shy one */}
      <g className={c.motion}>
        <ellipse cx="80" cy="221" rx="6" ry="3.5" fill="#1938A8" />
        <ellipse cx="96" cy="221" rx="6" ry="3.5" fill="#1938A8" />
        <polygon points="88,146 119.2,164 119.2,200 88,218 56.8,200 56.8,164" fill="#2352E0" stroke="#2352E0" strokeWidth="8" strokeLinejoin="round" />
        <path d="M88,138 C84,132 88,126 88,126 C88,126 92,132 88,138 Z" fill="#1938A8" />
        <ellipse cx="69" cy="190" rx="5" ry="3.5" fill="#F4A6A6" opacity="0.7" />
        <ellipse cx="107" cy="190" rx="5" ry="3.5" fill="#F4A6A6" opacity="0.7" />
        <Eyes f={c} mood={mood} r={7} pupilR={3.6} stroke={2.4} />
        {mood === 'sleepy' && (
          <text x="112" y="150" fontSize="13" fontFamily="Figtree Variable, sans-serif" fontWeight="800" fill="#1938A8">
            z z
          </text>
        )}
        <ellipse cx="54" cy="206" rx="7" ry="6" fill="#1938A8" style={handMotion(c.handL)} />
        <ellipse cx="122" cy="206" rx="7" ry="6" fill="#1938A8" style={handMotion(c.handR)} />
      </g>

      {/* Tram yellow — the leader, with a sprout */}
      <g className={a.motion}>
        <ellipse cx="180" cy="216" rx="10" ry="5" fill="#D99B00" />
        <ellipse cx="210" cy="216" rx="10" ry="5" fill="#D99B00" />
        <polygon points="195,88 248.7,119 248.7,181 195,212 141.3,181 141.3,119" fill="#FFC531" stroke="#FFC531" strokeWidth="10" strokeLinejoin="round" />
        <path d="M195,84 L195,70" stroke="#065A3F" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M195,72 C202,61 213,61 216,65 C210,74 201,76 195,72 Z" fill="#3FBF7F" />
        <ellipse cx="163" cy="162" rx="8" ry="5" fill="#F28C00" opacity="0.35" />
        <ellipse cx="227" cy="162" rx="8" ry="5" fill="#F28C00" opacity="0.35" />
        <Eyes f={a} mood={mood} r={11} pupilR={5.6} stroke={3} />
        <ellipse cx="136" cy="186" rx="12" ry="10" fill="#D99B00" style={handMotion(a.handL)} />
        <ellipse cx="254" cy="186" rx="12" ry="10" fill="#D99B00" style={handMotion(a.handR)} />
      </g>

      {/* Mint — the little one with a curl */}
      <g className={b.motion}>
        <ellipse cx="290" cy="222" rx="7" ry="4" fill="#9FD6BC" />
        <ellipse cx="310" cy="222" rx="7" ry="4" fill="#9FD6BC" />
        <polygon points="300,131 338.1,153 338.1,197 300,219 261.9,197 261.9,153" fill="#DCF2E7" stroke="#DCF2E7" strokeWidth="8" strokeLinejoin="round" />
        <path d="M298,128 C292,118 302,113 306,120" stroke="#065A3F" strokeWidth="3" fill="none" strokeLinecap="round" />
        <ellipse cx="277" cy="184" rx="6" ry="4" fill="#F4A6A6" opacity="0.8" />
        <ellipse cx="323" cy="184" rx="6" ry="4" fill="#F4A6A6" opacity="0.8" />
        <Eyes f={b} mood={mood} r={8.5} pupilR={4.3} stroke={2.6} />
        {mood === 'sad' && <path d="M320,180 C317,186 317,190 320,192 C323,190 323,186 320,180 Z" fill="#6FB5E8" />}
        <ellipse cx="257" cy="202" rx="9" ry="7.5" fill="#9FD6BC" style={handMotion(b.handL)} />
        <ellipse cx="343" cy="202" rx="9" ry="7.5" fill="#9FD6BC" style={handMotion(b.handR)} />
      </g>
    </svg>
  );
}

const CONFETTI = ['#FFC531', '#0A7A56', '#2352E0', '#E8452C', '#FFC531', '#3FA34D', '#2352E0', '#FFC531', '#0A7A56', '#E8452C', '#3FA34D'];

export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {CONFETTI.map((color, i) => (
        <span
          key={i}
          className="hx-confetti"
          style={{ left: `${8 + i * 8.2}%`, background: color, animationDelay: `${((i * 7) % 13) / 10}s` }}
        />
      ))}
    </div>
  );
}

/** A single small Hexie for empty states and the wordmark lock-up. */
export function Hexie({ size = 72, mood = 'neutral', color = 'tram' }: { size?: number; mood?: HexieMood; color?: 'tram' | 'sapphire' | 'mint' }) {
  const body = { tram: ['#FFC531', '#D99B00'], sapphire: ['#2352E0', '#1938A8'], mint: ['#DCF2E7', '#9FD6BC'] }[color];
  const [fill, dark] = body as [string, string];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className={mood === 'happy' ? 'hx-jump' : 'hx-breathe'}>
      <ellipse cx="50" cy="94" rx="30" ry="4" fill="#0E1A14" opacity="0.08" />
      <ellipse cx="40" cy="88" rx="6" ry="3.5" fill={dark} />
      <ellipse cx="60" cy="88" rx="6" ry="3.5" fill={dark} />
      <polygon points="50,12 84,31.5 84,70.5 50,90 16,70.5 16,31.5" fill={fill} stroke={fill} strokeWidth="8" strokeLinejoin="round" />
      <ellipse cx="30" cy="60" rx="6" ry="4" fill="#F28C00" opacity="0.3" />
      <ellipse cx="70" cy="60" rx="6" ry="4" fill="#F28C00" opacity="0.3" />
      {mood === 'happy' ? (
        <>
          <path d="M33,46 Q40,37 47,46" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M53,46 Q60,37 67,46" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M38,58 Q50,74 62,58 Z" fill="#0E1A14" />
        </>
      ) : mood === 'sleepy' ? (
        <>
          <path d="M33,46 Q40,51 47,46" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M53,46 Q60,51 67,46" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M45,63 L55,63" stroke="#0E1A14" strokeWidth="3" strokeLinecap="round" />
        </>
      ) : (
        <>
          <g className="hx-blink">
            <circle cx="40" cy="45" r="8" fill="#fff" />
            <circle cx="40" cy="47" r="4" fill="#0E1A14" />
            <circle cx="60" cy="45" r="8" fill="#fff" />
            <circle cx="60" cy="47" r="4" fill="#0E1A14" />
          </g>
          {mood === 'sad' ? (
            <path d="M42,66 Q50,59 58,66" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          ) : (
            <path d="M41,60 Q50,68 59,60" stroke="#0E1A14" strokeWidth="3" fill="none" strokeLinecap="round" />
          )}
        </>
      )}
    </svg>
  );
}

export function Logo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-display text-[22px] font-extrabold tracking-tight', onDark ? 'text-white' : 'text-ink', className)}>
      <svg width="26" height="28" viewBox="0 0 26 28" aria-hidden>
        <polygon points="13,0 26,7.5 26,20.5 13,28 0,20.5 0,7.5" fill={onDark ? '#FFFFFF' : '#0A7A56'} />
        <polygon points="13,7 19.5,10.75 19.5,17.25 13,21 6.5,17.25 6.5,10.75" fill="#FFC531" />
      </svg>
      <span>
        Help<span className={onDark ? 'text-tram' : 'text-brand'}>In</span>
      </span>
    </span>
  );
}
