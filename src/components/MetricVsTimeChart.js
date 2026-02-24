import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export default function MetricVsTimeChart({ data, metricColumn = 'value' }) {
  if (!data?.length) return null;

  return (
    <div className="metric-vs-time-chart">
      <p className="metric-chart-label">{metricColumn} vs time</p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.12)' }}
            tickLine={false}
            tickFormatter={(v) => {
              try {
                const d = new Date(v);
                return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' });
              } catch {
                return v;
              }
            }}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={50}
            tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : v)}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15, 15, 35, 0.92)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              color: '#e2e8f0',
            }}
            labelFormatter={(v) => {
              try {
                return new Date(v).toLocaleDateString();
              } catch {
                return v;
              }
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="#818cf8"
            strokeWidth={2}
            dot={{ fill: '#818cf8', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
