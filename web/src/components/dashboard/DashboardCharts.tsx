import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const CHART_COLORS = {
  brand: '#1a3a6b',
  accent: '#e0a02d',
  success: '#1e8e5a',
  info: '#1a6fb0',
  slate: '#8a94a8',
  danger: '#c0392b',
};

export const PROCUREMENT_TREND = [
  { month: 'Jan', value: 32 },
  { month: 'Feb', value: 38 },
  { month: 'Mar', value: 45 },
  { month: 'Apr', value: 52 },
  { month: 'May', value: 60 },
  { month: 'Jun', value: 48 },
];

export function ProcurementTrendChart() {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={PROCUREMENT_TREND} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="procurementFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.brand} stopOpacity={0.25} />
              <stop offset="100%" stopColor={CHART_COLORS.brand} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tick={{ fill: '#8a94a8', fontSize: 11 }}
          />
          <YAxis hide domain={[0, 70]} />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: '1px solid #e2e6ed',
              fontSize: 12,
            }}
            formatter={(v) => [`₹ ${v ?? 0} Cr`, 'RFQ Volume']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={CHART_COLORS.brand}
            strokeWidth={2.5}
            fill="url(#procurementFill)"
            dot={{ r: 3, fill: CHART_COLORS.brand, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const RFQ_STATUS_COLORS = [CHART_COLORS.info, CHART_COLORS.success, CHART_COLORS.slate, CHART_COLORS.danger];

export function RfqStatusDonut({
  data,
}: {
  data: { name: string; value: number; color?: string }[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="relative h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={52}
            outerRadius={72}
            paddingAngle={3}
            dataKey="value"
            stroke="none"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color ?? RFQ_STATUS_COLORS[i % RFQ_STATUS_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 10, border: '1px solid #e2e6ed', fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="font-display text-2xl font-bold tabular-nums text-ink">{total}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">RFQs</p>
        </div>
      </div>
    </div>
  );
}

export function BudgetGauge({ pct, utilized, remaining }: { pct: number; utilized: string; remaining: string }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[140px] w-[140px]">
        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
          <circle cx="64" cy="64" r={r} fill="none" stroke="#eef1f6" strokeWidth="10" />
          <circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={CHART_COLORS.success}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <p className="font-display text-2xl font-bold tabular-nums text-ink">{pct}%</p>
        </div>
      </div>
      <div className="mt-2 grid w-full grid-cols-2 gap-2 text-center text-xs">
        <div>
          <p className="text-ink-3">Utilized</p>
          <p className="font-semibold text-ink">{utilized}</p>
        </div>
        <div>
          <p className="text-ink-3">Remaining</p>
          <p className="font-semibold text-ink">{remaining}</p>
        </div>
      </div>
    </div>
  );
}
