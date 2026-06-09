'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table } from '@/components/ui/Table';
import { AddAssetModal } from '@/components/assets/AddAssetModal';
import { formatDate } from '@/lib/utils';
import type { AssetCondition, AssetStatus, UserRole } from '@/types';

type AssetRow = {
  id: string;
  name: string;
  tagNumber: string;
  location: string;
  condition: AssetCondition;
  status: AssetStatus;
  acquisitionDate: string;
  acquisitionCost: number;
  currency: string;
  category: { name: string };
  _count: { maintenance: number };
  disposal: { id: string; method: string; disposalDate: string } | null;
  [key: string]: unknown;
};

type OverdueAsset = {
  assetId: string;
  name: string;
  tagNumber: string;
  nextServiceDate: string;
};

interface Props {
  initialAssets:  AssetRow[];
  categories:     { id: string; name: string }[];
  stats:          { activeCount: number; maintenanceCount: number; disposedThisTerm: number };
  overdueAssets:  OverdueAsset[];
  userRole:       UserRole;
}

const CONDITION_OPTIONS = [
  { value: '',           label: 'All Conditions' },
  { value: 'EXCELLENT',  label: 'Excellent'       },
  { value: 'GOOD',       label: 'Good'            },
  { value: 'FAIR',       label: 'Fair'            },
  { value: 'POOR',       label: 'Poor'            },
  { value: 'CONDEMNED',  label: 'Condemned'       },
];

const STATUS_OPTIONS = [
  { value: '',                  label: 'All Statuses'      },
  { value: 'ACTIVE',            label: 'Active'            },
  { value: 'UNDER_MAINTENANCE', label: 'Under Maintenance' },
  { value: 'DISPOSED',          label: 'Disposed'          },
];

function conditionBadge(condition: AssetCondition) {
  const map: Record<AssetCondition, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
    EXCELLENT: { variant: 'success', label: 'Excellent'  },
    GOOD:      { variant: 'success', label: 'Good'       },
    FAIR:      { variant: 'warning', label: 'Fair'       },
    POOR:      { variant: 'danger',  label: 'Poor'       },
    CONDEMNED: { variant: 'danger',  label: 'Condemned'  },
  };
  const cfg = map[condition] ?? { variant: 'neutral', label: condition };
  return <Badge variant={cfg.variant} label={cfg.label} />;
}

function statusBadge(status: AssetStatus) {
  const map: Record<AssetStatus, { variant: 'success' | 'warning' | 'neutral'; label: string }> = {
    ACTIVE:            { variant: 'success', label: 'Active'            },
    UNDER_MAINTENANCE: { variant: 'warning', label: 'Under Maintenance' },
    DISPOSED:          { variant: 'neutral', label: 'Disposed'          },
  };
  const cfg = map[status] ?? { variant: 'neutral', label: status };
  return <Badge variant={cfg.variant} label={cfg.label} />;
}

export function AssetsClient({ initialAssets, categories, stats, overdueAssets, userRole }: Props) {
  const router = useRouter();

  const [q,         setQ]         = useState('');
  const [category,  setCategory]  = useState('');
  const [condition, setCondition] = useState('');
  const [status,    setStatus]    = useState('');

  const filtered = useMemo(() => {
    const qLower = q.toLowerCase();
    return initialAssets.filter((a) => {
      if (category  && a.category?.name !== categories.find((c) => c.id === category)?.name) return false;
      if (condition && a.condition !== condition) return false;
      if (status    && a.status    !== status)    return false;
      if (q && !a.name.toLowerCase().includes(qLower) && !a.tagNumber.toLowerCase().includes(qLower)) return false;
      return true;
    });
  }, [initialAssets, q, category, condition, status, categories]);

  const categoryOptions = [
    { value: '', label: 'All Categories' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ];

  const columns = [
    {
      key: 'tagNumber',
      label: 'Tag',
      render: (row: AssetRow) => (
        <span className="font-mono text-xs text-[#78716c]">{row.tagNumber}</span>
      ),
    },
    {
      key: 'name',
      label: 'Name',
      render: (row: AssetRow) => (
        <span className="font-medium text-[#292524]">{row.name}</span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row: AssetRow) => (row.category as { name: string })?.name ?? '—',
    },
    {
      key: 'location',
      label: 'Location',
      render: (row: AssetRow) => row.location,
    },
    {
      key: 'condition',
      label: 'Condition',
      render: (row: AssetRow) => conditionBadge(row.condition),
    },
    {
      key: 'status',
      label: 'Status',
      render: (row: AssetRow) => statusBadge(row.status),
    },
    {
      key: 'actions',
      label: '',
      render: (row: AssetRow) => (
        <button
          onClick={(e) => { e.stopPropagation(); router.push(`/assets/${row.id}`); }}
          className="text-xs font-medium text-[#065f46] hover:underline"
        >
          View
        </button>
      ),
    },
  ];

  const canManage = ['DIRECTOR', 'HEAD', 'BURSAR'].includes(userRole);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Asset Register</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">Track and manage school assets</p>
        </div>
        {canManage && (
          <AddAssetModal categories={categories} />
        )}
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active',            value: stats.activeCount,       color: '#065f46' },
          { label: 'Under Maintenance', value: stats.maintenanceCount,  color: '#d97706' },
          { label: 'Disposed (Term)',   value: stats.disposedThisTerm,  color: '#78716c' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-[#e7e5e4] bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums" style={{ color }}>{value}</p>
          </div>
        ))}
      </div>

      {/* Overdue maintenance banner */}
      {overdueAssets.length > 0 && (
        <div className="rounded-xl border border-[#fde68a] bg-[#fffbeb] p-4">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d97706]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-[#92400e]">
                {overdueAssets.length} asset{overdueAssets.length !== 1 ? 's' : ''} overdue for service
              </p>
              <ul className="mt-2 space-y-1">
                {overdueAssets.map((o) => (
                  <li key={o.assetId} className="text-sm text-[#92400e]">
                    <button
                      onClick={() => router.push(`/assets/${o.assetId}`)}
                      className="hover:underline"
                    >
                      {o.name} ({o.tagNumber})
                    </button>
                    {' '}— next service was{' '}
                    <span className="font-medium">{formatDate(o.nextServiceDate)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Input
          id="asset-search"
          placeholder="Search name or tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select
          id="filter-category"
          options={categoryOptions}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Select
          id="filter-condition"
          options={CONDITION_OPTIONS}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
        <Select
          id="filter-status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        />
      </div>

      {/* Table */}
      <Table
        columns={columns as never}
        data={filtered}
        emptyMessage="No assets found."
        onRowClick={(row) => router.push(`/assets/${(row as AssetRow).id}`)}
      />
    </div>
  );
}
