'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Table } from '@/components/ui/Table';
import { FileUpload } from '@/components/ui/FileUpload';
import { useToast } from '@/components/ui/Toast';
import { MaintenanceModal } from '@/components/assets/MaintenanceModal';
import { DisposeModal } from '@/components/assets/DisposeModal';
import { UpdateAssetSchema } from '@/lib/validations/assets';
import { formatDate, formatUSD, formatZiG } from '@/lib/utils';
import type { AssetCondition, AssetStatus, UserRole } from '@/types';
import type { z } from 'zod';

type UpdateValues = z.infer<typeof UpdateAssetSchema>;

type MaintenanceRecord = {
  id: string;
  maintenanceDate: string;
  description: string;
  cost: number | null;
  currency: string | null;
  provider: string | null;
  nextServiceDate: string | null;
  createdAt: string;
  recorder: { fullName: string };
  [key: string]: unknown;
};

type DisposalRecord = {
  id: string;
  disposalDate: string;
  reason: string;
  method: string;
  proceeds: number | null;
  currency: string | null;
  createdAt: string;
  recorder: { fullName: string };
} | null;

type Asset = {
  id: string;
  name: string;
  tagNumber: string;
  description: string | null;
  location: string;
  custodian: string | null;
  condition: AssetCondition;
  status: AssetStatus;
  acquisitionDate: string;
  acquisitionCost: number;
  currency: string;
  imageUrl: string | null;
  createdAt: string;
  category: { id: string; name: string };
  maintenance: MaintenanceRecord[];
  disposal: DisposalRecord;
};

interface Props {
  asset:      Asset;
  categories: { id: string; name: string }[];
  userRole:   UserRole;
}

const CONDITION_OPTIONS = [
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD',      label: 'Good'      },
  { value: 'FAIR',      label: 'Fair'      },
  { value: 'POOR',      label: 'Poor'      },
  { value: 'CONDEMNED', label: 'Condemned' },
];

const STATUS_OPTIONS = [
  { value: 'ACTIVE',            label: 'Active'            },
  { value: 'UNDER_MAINTENANCE', label: 'Under Maintenance' },
  { value: 'DISPOSED',          label: 'Disposed'          },
];

function conditionBadge(condition: AssetCondition) {
  const map: Record<AssetCondition, 'success' | 'warning' | 'danger'> = {
    EXCELLENT: 'success', GOOD: 'success', FAIR: 'warning', POOR: 'danger', CONDEMNED: 'danger',
  };
  return <Badge variant={map[condition] ?? 'neutral'} label={condition.charAt(0) + condition.slice(1).toLowerCase()} />;
}

function statusBadge(status: AssetStatus) {
  const map: Record<AssetStatus, 'success' | 'warning' | 'neutral'> = {
    ACTIVE: 'success', UNDER_MAINTENANCE: 'warning', DISPOSED: 'neutral',
  };
  const labels: Record<AssetStatus, string> = {
    ACTIVE: 'Active', UNDER_MAINTENANCE: 'Under Maintenance', DISPOSED: 'Disposed',
  };
  return <Badge variant={map[status] ?? 'neutral'} label={labels[status] ?? status} />;
}

function formatAmount(amount: number | null, currency: string | null) {
  if (amount == null) return '—';
  return currency === 'ZIG' ? formatZiG(amount) : formatUSD(amount);
}

export function AssetDetailClient({ asset: initialAsset, categories, userRole }: Props) {
  const router = useRouter();
  const toast  = useToast();

  const [asset,      setAsset]      = useState(initialAsset);
  const [editMode,   setEditMode]   = useState(false);
  const [showMaint,  setShowMaint]  = useState(false);
  const [showDispose, setShowDispose] = useState(false);

  const canManage  = ['DIRECTOR', 'HEAD', 'BURSAR'].includes(userRole);
  const canDispose = ['DIRECTOR', 'HEAD'].includes(userRole);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<UpdateValues>({
    resolver: zodResolver(UpdateAssetSchema),
    defaultValues: {
      condition: asset.condition,
      location:  asset.location,
      custodian: asset.custodian ?? '',
      status:    asset.status,
      imageUrl:  asset.imageUrl ?? '',
    },
  });

  const editImageUrl = watch('imageUrl');

  function cancelEdit() {
    reset({
      condition: asset.condition,
      location:  asset.location,
      custodian: asset.custodian ?? '',
      status:    asset.status,
      imageUrl:  asset.imageUrl ?? '',
    });
    setEditMode(false);
  }

  async function onSave(values: UpdateValues) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.message ?? 'Failed to update asset');
      return;
    }
    toast.success('Asset updated');
    setAsset((prev) => ({ ...prev, ...data.data.asset }));
    setEditMode(false);
    router.refresh();
  }

  const maintenanceCols = [
    {
      key: 'maintenanceDate',
      label: 'Date',
      render: (row: MaintenanceRecord) => formatDate(row.maintenanceDate),
    },
    {
      key: 'description',
      label: 'Description',
      render: (row: MaintenanceRecord) => row.description,
    },
    {
      key: 'cost',
      label: 'Cost',
      render: (row: MaintenanceRecord) => formatAmount(row.cost, row.currency),
    },
    {
      key: 'provider',
      label: 'Provider',
      render: (row: MaintenanceRecord) => row.provider ?? '—',
    },
    {
      key: 'nextServiceDate',
      label: 'Next Service',
      render: (row: MaintenanceRecord) =>
        row.nextServiceDate ? formatDate(row.nextServiceDate) : '—',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#78716c]">
        <Link href="/assets" className="hover:text-[#292524] hover:underline">
          Assets
        </Link>
        <span>/</span>
        <span className="text-[#292524]">{asset.name}</span>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#292524]">{asset.name}</h1>
            <p className="mt-0.5 font-mono text-sm text-[#78716c]">{asset.tagNumber}</p>
          </div>
          {statusBadge(asset.status)}
        </div>
        <div className="flex items-center gap-2">
          {canManage && !editMode && asset.status !== 'DISPOSED' && (
            <Button variant="secondary" onClick={() => setShowMaint(true)}>
              Log Maintenance
            </Button>
          )}
          {canDispose && !editMode && asset.status !== 'DISPOSED' && (
            <Button variant="danger" onClick={() => setShowDispose(true)}>
              Record Disposal
            </Button>
          )}
          {canManage && !editMode && (
            <Button onClick={() => setEditMode(true)}>Edit</Button>
          )}
        </div>
      </div>

      {/* Asset info card */}
      <Card
        title="Asset Details"
        action={
          editMode ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={cancelEdit} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button size="sm" form="edit-asset-form" type="submit" loading={isSubmitting}>
                Save
              </Button>
            </div>
          ) : undefined
        }
      >
        {editMode ? (
          <form id="edit-asset-form" onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                id="edit-condition"
                label="Condition"
                options={CONDITION_OPTIONS}
                error={errors.condition?.message}
                {...register('condition')}
              />
              <Select
                id="edit-status"
                label="Status"
                options={STATUS_OPTIONS}
                error={errors.status?.message}
                {...register('status')}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="edit-location"
                label="Location"
                error={errors.location?.message}
                {...register('location')}
              />
              <Input
                id="edit-custodian"
                label="Custodian"
                placeholder="Leave blank to clear"
                error={errors.custodian?.message}
                {...register('custodian')}
              />
            </div>
            <FileUpload
              endpoint="assetImage"
              label="Asset Image"
              existingUrl={editImageUrl || asset.imageUrl || undefined}
              onUpload={(url) => setValue('imageUrl', url)}
            />
          </form>
        ) : (
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Category',         value: asset.category.name },
              { label: 'Location',         value: asset.location },
              { label: 'Custodian',        value: asset.custodian ?? '—' },
              { label: 'Condition',        value: conditionBadge(asset.condition) },
              { label: 'Acquisition Date', value: formatDate(asset.acquisitionDate) },
              { label: 'Acquisition Cost', value: formatAmount(asset.acquisitionCost, asset.currency) },
              { label: 'Added',            value: formatDate(asset.createdAt) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</p>
                <p className="mt-1 text-sm text-[#292524]">{value}</p>
              </div>
            ))}
            {asset.description && (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Description</p>
                <p className="mt-1 text-sm text-[#292524]">{asset.description}</p>
              </div>
            )}
            {asset.imageUrl && (
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Image</p>
                <a
                  href={asset.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 text-sm text-[#065f46] underline underline-offset-2"
                >
                  View image
                </a>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Disposal card */}
      {asset.disposal && (
        <Card title="Disposal Record">
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Method',       value: asset.disposal.method },
              { label: 'Date',         value: formatDate(asset.disposal.disposalDate) },
              { label: 'Proceeds',     value: formatAmount(asset.disposal.proceeds, asset.disposal.currency) },
              { label: 'Recorded by',  value: asset.disposal.recorder.fullName },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">{label}</p>
                <p className="mt-1 text-sm text-[#292524]">{value}</p>
              </div>
            ))}
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#78716c]">Reason</p>
              <p className="mt-1 text-sm text-[#292524]">{asset.disposal.reason}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Maintenance history */}
      <Card
        title="Maintenance History"
        subtitle={`${asset.maintenance.length} record${asset.maintenance.length !== 1 ? 's' : ''}`}
      >
        <Table
          columns={maintenanceCols as never}
          data={asset.maintenance}
          emptyMessage="No maintenance records yet."
        />
      </Card>

      {/* Modals */}
      <MaintenanceModal
        assetId={asset.id}
        assetName={asset.name}
        open={showMaint}
        onClose={() => setShowMaint(false)}
        onSuccess={() => { setShowMaint(false); router.refresh(); }}
      />
      <DisposeModal
        assetId={asset.id}
        assetName={asset.name}
        open={showDispose}
        onClose={() => setShowDispose(false)}
        onSuccess={() => { setShowDispose(false); router.refresh(); }}
      />
    </div>
  );
}
