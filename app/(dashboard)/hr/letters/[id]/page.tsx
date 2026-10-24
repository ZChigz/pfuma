import { getHrAccess as getAccess } from '@/lib/hr/access';
import { getLetter } from '@/lib/hr/letters';
import { ServiceError } from '@/lib/api';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PrintButton } from '@/components/hr/PrintButton';

export const metadata = { title: 'Letter · Pfuma' };

export default async function LetterPage({ params }: { params: { id: string } }) {
  const { user } = await getAccess();
  let l;
  try { l = await getLetter(user, params.id); } catch (e) { if (e instanceof ServiceError && e.status < 500) return <AccessDenied message={e.status === 404 ? 'This letter does not exist.' : undefined} />; throw e; }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-8">
      <div className="flex justify-end print:hidden"><PrintButton label="Print" /></div>
      <article className="rounded-2xl bg-white p-8 text-sm leading-relaxed text-ink print:rounded-none print:p-0">
        <header className="mb-6 border-b border-line pb-3 text-center">
          {l.school.logoUrl && /* eslint-disable-next-line @next/next/no-img-element */ <img src={l.school.logoUrl} alt="" className="mx-auto mb-2 h-14 object-contain" />}
          <h1 className="text-lg font-bold uppercase tracking-wide">{l.school.name}</h1>
          <p className="text-xs text-muted">{[l.school.address, l.school.phone, l.school.email].filter(Boolean).join(' · ')}</p>
        </header>
        <p className="mb-4 flex justify-between text-xs text-muted"><span>Ref: {l.reference}</span><span>{l.employee}</span></p>
        <h2 className="mb-3 text-base font-semibold">{l.title}</h2>
        {l.paragraphs.map((p, i) => <p key={i} className="mb-3">{p}</p>)}
        <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-muted"><div className="border-t border-line pt-1">For the school</div><div className="border-t border-line pt-1">Employee</div></div>
      </article>
    </div>
  );
}
