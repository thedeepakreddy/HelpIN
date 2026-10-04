/** Maps a user/community colour key to tint + ink classes (rich palette, AA contrast). */
export const TONES: Record<string, { bg: string; fg: string; solid: string }> = {
  brand: { bg: 'bg-brand-tint', fg: 'text-brand-ink', solid: 'bg-brand' },
  tram: { bg: 'bg-tram-tint', fg: 'text-tram-ink', solid: 'bg-tram' },
  sapphire: { bg: 'bg-sapphire-tint', fg: 'text-sapphire-ink', solid: 'bg-sapphire' },
  amber: { bg: 'bg-amber-tint', fg: 'text-amber-ink', solid: 'bg-amber' },
  coral: { bg: 'bg-coral-tint', fg: 'text-coral-ink', solid: 'bg-coral' },
  mint: { bg: 'bg-brand-tint', fg: 'text-brand-ink', solid: 'bg-mint' },
};

export const tone = (key: string) => TONES[key] ?? TONES.brand!;
