'use client';

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const SLICE_COLORS = [
  '#065f46',
  '#047857',
  '#059669',
  '#10b981',
  '#f59e0b',
  '#d97706',
  '#b45309',
] as const;

export interface ExpenseSlice {
  category: string;
  total: number;
}

interface Props {
  data: ExpenseSlice[];
  currency: string;
}

export function ExpensePieChart({ data, currency }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-[#78716c]">
        No expense data for this currency
      </div>
    );
  }

  const fmtVal = (v: number) =>
    currency === 'USD'
      ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `ZiG ${Math.round(v).toLocaleString('en-US')}`;

  return (
    <ResponsiveContainer width="100%" height={264}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="46%"
          outerRadius={88}
          dataKey="total"
          nameKey="category"
          labelLine={false}
          label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
            if (percent < 0.06) return null;
            const RADIAN = Math.PI / 180;
            const r = innerRadius + (outerRadius - innerRadius) * 0.55;
            const x = cx + r * Math.cos(-midAngle * RADIAN);
            const y = cy + r * Math.sin(-midAngle * RADIAN);
            return (
              <text
                x={x}
                y={y}
                fill="white"
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={600}
              >
                {`${(percent * 100).toFixed(0)}%`}
              </text>
            );
          }}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number, name: string) => [fmtVal(v), name]}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid #e7e5e4',
            fontSize: '12px',
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '11px', color: '#78716c' }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
