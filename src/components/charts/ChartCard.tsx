'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/Card'

export interface Point {
  label: string
  value: number
}

interface ChartCardProps {
  title: string
  data: Point[]
  kind: 'bar' | 'line'
  /** A Warm Civic palette CSS variable, e.g. 'var(--moss)'. */
  color?: string
  valueLabel?: string
  empty?: string
}

const AXIS = 'var(--muted)'
const GRID = 'var(--line)'
const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  color: 'var(--ink)',
  fontSize: 12,
}

/**
 * A single dashboard chart, themed strictly to the Warm Civic palette, with animation disabled
 * (reduced-motion safe) and an always-available data table for an accessible, non-visual
 * equivalent. The SVG is aria-hidden; the table carries the same numbers for assistive tech.
 */
export function ChartCard({
  title,
  data,
  kind,
  color = 'var(--moss)',
  valueLabel = 'Count',
  empty = 'No data yet.',
}: ChartCardProps) {
  return (
    <Card className="space-y-3">
      <p className="eyebrow">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <>
          <div aria-hidden="true" style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              {kind === 'bar' ? (
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={GRID}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke={GRID}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--line)', opacity: 0.4 }} />
                  <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              ) : (
                <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke={GRID}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    stroke={GRID}
                    tick={{ fill: AXIS, fontSize: 11 }}
                    tickLine={false}
                    allowDecimals={false}
                    width={32}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: 'var(--sage)' }} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke={color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Show data table</summary>
            <table className="mt-2 w-full text-left">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-4 font-medium text-muted">
                    Label
                  </th>
                  <th scope="col" className="font-medium text-muted">
                    {valueLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.label}>
                    <td className="pr-4 text-muted break-words">{d.label}</td>
                    <td className="text-ink tabular-nums">{d.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </Card>
  )
}
