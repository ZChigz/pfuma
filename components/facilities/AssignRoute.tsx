'use client';

// Put a learner on a route: find the learner, choose the route and the stops. The transport charge is raised by the server.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { api, problem, Notice, fieldClass } from '@/components/finance/shared';
import { LearnerPicker, type Learner } from '@/components/facilities/LearnerPicker';

export interface RouteOption { id: string; name: string; feeText: string; stops: { id: string; name: string }[] }

export function AssignRoute({ routes }: { routes: RouteOption[] }) {
  const router = useRouter();
  const [s, setS] = useState<Learner | null>(null);
  const [routeId, setRouteId] = useState(routes[0]?.id ?? '');
  const [am, setAm] = useState('');
  const [pm, setPm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = routes.find((r) => r.id === routeId);

  async function save() {
    if (!s) { setError('Choose the learner'); return; }
    setBusy(true); setError(null);
    const r = await api('/api/facilities/transport/assign', 'POST', { studentId: s.id, routeId, amStopId: am, pmStopId: pm || undefined });
    setBusy(false);
    if (!r.ok) { setError(problem(r)); return; }
    toast.success('Learner added to the route');
    setS(null); setAm(''); setPm('');
    router.refresh();
  }

  if (routes.length === 0) return <p className="text-sm text-muted">Add a route with stops first.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-3">
      <LearnerPicker id="route-learner" value={s} onChange={setS} />
      <select aria-label="Route" className={fieldClass} value={routeId} onChange={(e) => { setRouteId(e.target.value); setAm(''); setPm(''); }}>{routes.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.feeText}</option>)}</select>
      <select aria-label="Morning stop" className={fieldClass} value={am} onChange={(e) => setAm(e.target.value)}><option value="">Morning stop</option>{route?.stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select aria-label="Afternoon stop" className={fieldClass} value={pm} onChange={(e) => setPm(e.target.value)}><option value="">Afternoon stop (same as morning)</option>{route?.stops.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      {error && <Notice tone="danger">{error}</Notice>}
      <Button className="min-h-[52px]" loading={busy} onClick={() => void save()}>Add to route</Button>
    </div>
  );
}
