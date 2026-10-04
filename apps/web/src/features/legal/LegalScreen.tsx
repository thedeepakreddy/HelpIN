import { Link, useRouter } from '@tanstack/react-router';
import { ArrowLeft, FileWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../../components/domain/Hexies';
import { IconButton } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/primitives';

/**
 * Legal pages (Roadmap Phase 6, ADR-019, ADR-025). These are DRAFTS written from the plan and
 * must be reviewed by a lawyer before the public launch. Operator details are placeholders that
 * the founder fills in from private records; they are deliberately not stored in the repo.
 */
const PAGES: Record<string, { title: string; sections: [string, string][] }> = {
  guidelines: {
    title: 'Community guidelines',
    sections: [
      ['Help is always free', 'HelpIn is mutual help between neighbours, not a marketplace. Don’t offer or ask for paid work, prices, selling, renting or advertising. A coffee to say thanks is fine.'],
      ['Only real problems', 'Post problems that are real and current. Made-up problems, pranks, or posts to farm karma are not allowed. A fake problem upheld by a moderator costs 20 karma and anonymous posting for 90 days; a second one in 180 days restricts the account.'],
      ['Be kind and respectful', 'No harassment, hate, threats or discrimination. Disagree politely. Respect people’s time: answer helpers who offered to help you.'],
      ['Protect privacy', 'Don’t post anyone’s address, phone number, ID documents, or photos of people without their consent. Cover names and numbers on letters. Don’t accuse a named private person.'],
      ['Not an emergency service', 'If anyone is in danger, call 112 first. HelpIn doesn’t replace medical, legal or emergency help.'],
      ['Stay safe', 'Never send money or ID documents to someone you met on HelpIn. Meet in public places when you can. Report anything that feels wrong.'],
      ['What moderators do', 'Reported content may be hidden while it’s reviewed. If we remove something or restrict an account, you get a statement of reasons and can appeal once.'],
    ],
  },
  privacy: {
    title: 'Privacy notice',
    sections: [
      ['Who is responsible', 'HelpIn is operated by [operator name], an individual, as data controller (see the imprint). Contact: [privacy contact address].'],
      ['What we collect', 'Your phone number (always verified, never shown), email if you use it to sign in, your profile (name, bio, languages, optional photo), your home area as a ~5 km² hexagon (never a point), your problems, offers, messages, posts and karma.'],
      ['Locations', 'Problems are shown as an area, never your exact spot. If you save an exact spot, it stays private and is only shared when you choose “Share exact location” in a chat. Exact locations are deleted 7 days after a problem ends. Photo metadata (including GPS) is removed before anyone else can see a photo.'],
      ['Why we use it', 'To run HelpIn (contract), to keep it safe and prevent abuse (legitimate interest), to send notifications you turned on (consent), and to meet legal duties such as handling reports under the EU Digital Services Act.'],
      ['Who we share it with', 'Processors that host or deliver the service inside the EU (database and storage hosting, SMS and email delivery, web push services). We don’t sell data and we don’t show ads.'],
      ['How long we keep it', 'While your account exists. Location data as above. Moderation records as required by law. When you delete your account, your profile, posts and photos are deleted, and your problems and messages remain for the other people involved, shown as “Deleted user”.'],
      ['Your rights', 'You can download your data and delete your account in Settings at any time. You can also ask for access, correction, restriction or objection, and complain to the Hungarian data protection authority (NAIH).'],
    ],
  },
  terms: {
    title: 'Terms of use',
    sections: [
      ['Who can use HelpIn', 'People aged 18 or older with a verified phone number, one account per person and number.'],
      ['What HelpIn is', 'A free platform where neighbours in Budapest ask for and offer help. HelpIn connects people; it doesn’t provide the help itself and isn’t responsible for what people do when they meet.'],
      ['Your content', 'You keep your content. You give HelpIn permission to show it in the app as you choose (for example on the map, in the feed or in a community). Don’t post anything you don’t have the right to share.'],
      ['Karma', 'Karma is a thank-you signal, not money. It can’t be bought, sold or exchanged, and moderators may reverse karma gained by abuse.'],
      ['Rules', 'Follow the community guidelines. We may hide or remove content and restrict accounts that break them, with a statement of reasons and a right to appeal.'],
      ['Changes and contact', 'We’ll tell you in the app before important changes. Questions: [contact address].'],
    ],
  },
  imprint: {
    title: 'Imprint',
    sections: [
      ['Operator', '[Operator full name], individual operator (ADR-025)\n[Postal address], Budapest, Hungary'],
      ['Contact', 'Email: [contact address]\nDSA single point of contact: [contact address] (English, Hungarian)'],
      ['Reporting illegal content', 'Use “Report” on any problem, offer, message, post, comment or profile. Serious reports are reviewed within 2 hours, others within 24 hours.'],
    ],
  },
};

export function LegalScreen({ page }: { page: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const doc = PAGES[page];
  if (!doc) return <EmptyState title={t('legal.notFound')} />;
  return (
    <div className="min-h-dvh bg-paper">
      <div className="mx-auto max-w-2xl px-5 pt-[max(12px,env(safe-area-inset-top))] pb-12">
        <header className="flex items-center justify-between">
          <IconButton label={t('common.back')} className="-ml-2" onClick={() => router.history.back()}>
            <ArrowLeft size={22} />
          </IconButton>
          <Link to="/welcome" className="no-underline">
            <Logo className="text-[18px]" />
          </Link>
          <span className="w-11" />
        </header>
        <h1 className="mt-4 font-display text-[32px] font-extrabold tracking-tight">{doc.title}</h1>
        <p className="mt-3 flex gap-2 rounded-2xl bg-amber-tint p-3.5 text-[13px] font-semibold text-amber-ink">
          <FileWarning size={18} className="shrink-0" />
          {t('legal.draft')}
        </p>
        {doc.sections.map(([h, body]) => (
          <section key={h} className="mt-6">
            <h2 className="font-display text-[19px] font-bold">{h}</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{body}</p>
          </section>
        ))}
        <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2 text-[14px] font-bold">
          {Object.keys(PAGES)
            .filter((p) => p !== page)
            .map((p) => (
              <Link key={p} to="/legal/$page" params={{ page: p }} className="text-brand">
                {PAGES[p]!.title}
              </Link>
            ))}
        </nav>
      </div>
    </div>
  );
}
