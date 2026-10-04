import type { Db, Tx } from '@helpin/db';
import { now } from './clock';

/** Domain events (Domain Model §10). Payloads carry ids only; consumers load what they need. */
export type DomainEvent =
  | { type: 'ProblemCreated'; problemId: string }
  | { type: 'NearbySecondWave'; problemId: string; notified: string[] }
  | { type: 'HelpOffered'; offerId: string }
  | { type: 'OfferAccepted'; offerId: string; conversationId: string }
  | { type: 'OfferDeclined'; offerId: string }
  | { type: 'MessageSent'; messageId: number; conversationId: string }
  | { type: 'SolveClaimed'; offerId: string }
  | { type: 'ProblemSolved'; problemId: string; via: 'asker' | 'fixed_quorum' }
  | { type: 'HelperCredited'; problemId: string; helperId: string; amount: number }
  | { type: 'AskerClosingAward'; problemId: string; amount: number }
  | { type: 'ProblemUpdated'; problemId: string; updateId: string }
  | { type: 'ProblemClosed'; problemId: string; status: 'abandoned' | 'expired' | 'withdrawn' | 'removed' }
  | { type: 'ResponseReminder'; problemId: string; stage: 1 | 2 }
  | { type: 'RaiserPenalized'; problemId: string; amount: number; onNotice: boolean }
  | { type: 'AffectedAdded'; problemId: string; userId: string }
  | { type: 'PostTagged'; postId: string; userId: string }
  | { type: 'CommentAdded'; commentId: string }
  | { type: 'ContentRemoved'; moderationActionId: number; userId: string }
  | { type: 'MediaUploaded'; mediaId: string }
  | { type: 'KarmaReversed'; entryId: number; userId: string };

/** Appends an event in the caller's transaction, so it exists iff the change commits. */
export async function appendEvent(tx: Tx | Db, event: DomainEvent, opts: { delayMs?: number } = {}) {
  const aggregate =
    'problemId' in event ? ['problem', event.problemId] : 'offerId' in event ? ['offer', event.offerId] : 'mediaId' in event ? ['media', event.mediaId] : ['other', ''];
  await tx
    .insertInto('outbox_events')
    .values({
      type: event.type,
      aggregate_type: aggregate[0]!,
      aggregate_id: String(aggregate[1]),
      payload: JSON.stringify(event),
      next_attempt_at: new Date(now().getTime() + (opts.delayMs ?? 0)),
      created_at: now(),
    })
    .execute();
}
