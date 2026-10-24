import { getHrAccess as getAccess } from '@/lib/hr/access';
import { listPosts } from '@/lib/hr/recruitment';
import { listDirectory } from '@/lib/hr/employees';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { FormAction } from '@/components/finance/FormAction';
import { Money } from '@/components/finance/format';
import { Notice, RowAction, Section, Td, Th } from '@/components/finance/shared';
import { HrNav } from '@/components/hr/HrNav';

export const metadata = { title: 'Posts · Pfuma' };

export default async function PostsPage() {
  const { user, can } = await getAccess();
  if (!can('hr.posts.manage') && !can('hr.posts.approve')) return <AccessDenied />;
  const posts = await listPosts(user);
  const depts = can('hr.directory.view') ? (await listDirectory(user, { pageSize: 1 })).departments : [];
  const pending = posts.filter((p) => p.status === 'PENDING');
  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="Posts" description="Every position the school has, how many are filled and how many are vacant. A new post adds to the wage bill, so the Head and the Owner both approve it before anyone is hired."
        actions={can('hr.posts.manage') && (
          <FormAction label="Ask for a new post" variant="primary" size="md" url="/api/hr/posts" done="Sent for approval"
            fields={[{ name: 'title', label: 'Post (for example Science teacher)', required: true }, { name: 'count', label: 'How many places', type: 'number', required: true, initial: '1' },
              { name: 'category', label: 'Category', type: 'select', required: true, options: ['TEACHING', 'ADMINISTRATION', 'ANCILLARY', 'BOARDING', 'SECURITY', 'GROUNDS'].map((c) => ({ value: c, label: c.charAt(0) + c.slice(1).toLowerCase() })) },
              { name: 'departmentId', label: 'Department', type: 'select', options: depts.map((d) => ({ value: d.id, label: d.name })) },
              { name: 'monthlyCostCents', label: 'Expected monthly cost of one place', type: 'cents', required: true }, { name: 'currency', label: 'Currency', type: 'select', options: [{ value: 'USD', label: 'US dollars' }, { value: 'ZIG', label: 'ZiG' }] }, { name: 'note', label: 'Why is it needed?', type: 'textarea' }]} />
        )} />
      <HrNav can={can} current="/hr/posts" />
      {pending.length > 0 && can('hr.posts.approve') && <Notice tone="info">{pending.length} post{pending.length === 1 ? '' : 's'} waiting for approval. The Head and the Owner each approve; they must be two different people.</Notice>}
      <Section title="Establishment">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem]">
            <thead><tr><Th>Post</Th><Th>Department</Th><Th className="text-right">Places</Th><Th className="text-right">Filled</Th><Th className="text-right">Vacant</Th><Th className="text-right">Cost a month</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <Td>{p.title}<div className="text-xs text-muted">{p.employer === 'GOVERNMENT' ? 'Government-paid' : 'School-paid'}</div></Td><Td>{p.department ?? '—'}</Td>
                  <Td className="text-right">{p.count}</Td><Td className="text-right">{p.filled}</Td><Td className="text-right">{p.vacant}</Td>
                  <Td className="text-right">{p.monthlyTotalCents != null ? <Money cents={p.monthlyTotalCents} currency={p.currency as 'USD' | 'ZIG'} /> : '—'}</Td>
                  <Td><Badge variant={p.status === 'APPROVED' ? 'success' : p.status === 'PENDING' ? 'warning' : 'neutral'} label={p.status === 'PENDING' ? `Waiting (${p.headApproved ? 'Head ✓' : 'Head'} · ${p.ownerApproved ? 'Owner ✓' : 'Owner'})` : p.status.charAt(0) + p.status.slice(1).toLowerCase()} /></Td>
                  <Td>{p.status === 'PENDING' && can('hr.posts.approve') && (
                    <div className="flex gap-2">
                      <RowAction label="Approve" variant="primary" url={`/api/hr/posts/${p.id}/decision`} body={{ decision: 'APPROVE' }} done="Approved" />
                      <RowAction label="Reject" variant="danger" url={`/api/hr/posts/${p.id}/decision`} body={{ decision: 'REJECT' }} reason={{ label: 'Why is it rejected?', min: 3 }} done="Rejected" />
                    </div>)}</Td>
                </tr>
              ))}
              {posts.length === 0 && <tr><Td className="text-muted">No posts yet.</Td></tr>}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
