'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export interface TrendPoint {
  week: string;
  collected: number | null;
  projected: number | null;
}

interface Props {
  data: TrendPoint[];
  currency: string;
}

function shortWeek(isoWeek: string): string {
  return isoWeek.replace(/^\d{4}-/, '');
}

export function CollectionTrendChart({ data, currency }: Props) {
  const chartData = data.map(d => ({
    week: shortWeek(d.week),
    collected: d.collected,
    projected: d.projected,
  }));

  const fmtTick = (v: number) => {
    if (v === 0) return '0';
    return currency === 'USD'
      ? `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`
      : `Z${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`;
  };

  const fmtTooltip = (v: number) =>
    currency === 'USD'
      ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `ZiG ${Math.round(v).toLocaleString('en-US')}`;

  return (
    <ResponsiveContainer width="100%" height={264}>
      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
        <XAxis
          dataKey="week"
          tick={{ fontSize: 11, fill: '#78716c' }}
          tickLine={false}
          axisLine={{ stroke: '#e7e5e4' }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#78716c' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={fmtTick}
          width={42}
        />
        <Tooltip
          formatter={(v: number, name: string) => [fmtTooltip(v), name === 'collected' ? 'Collected' : 'Projected']}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid #e7e5e4',
            fontSize: '12px',
          }}
        />
        <Legend
          iconSize={10}
          wrapperStyle={{ fontSize: '11px', color: '#78716c' }}
          formatter={(v) => (v === 'collected' ? 'Collected' : 'Projected')}
        />
        <Line
          type="monotone"
          dataKey="collected"
          stroke="#065f46"
          strokeWidth={2}
          dot={{ r: 3, fill: '#065f46', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#065f46' }}
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="projected"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }}
          activeDot={{ r: 5, fill: '#f59e0b' }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
