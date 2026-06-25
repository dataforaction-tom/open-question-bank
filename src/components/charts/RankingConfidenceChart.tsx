'use client'

import {
  CartesianGrid,
  ErrorBar,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/Card'

export interface RankingPoint {
  rank: number
  canonicalText: string
  mu: number
  sigma: number
  nComparisons: number
}

const AXIS = 'var(--muted)'
const GRID = 'var(--line)'

/**
 * Visual ranking confidence: each ranked question's score (μ) with a ±σ uncertainty band, so the
 * public can see not just the order but how settled it is. Themed to the palette, animation off
 * (reduced-motion safe), with a full data table as the accessible equivalent.
 */
export function RankingConfidenceChart({ items }: { items: RankingPoint[] }) {
  if (items.length === 0) return null
  const data = items.map((it) => ({
    name: `#${it.rank}`,
    mu: Number(it.mu.toFixed(2)),
    sigma: Number(it.sigma.toFixed(2)),
  }))

  return (
    <Card className="space-y-3">
      <p className="eyebrow">Ranking confidence</p>
      <p className="text-sm text-muted">
        Score (μ) per rank with its uncertainty (±σ). Tighter bands mean a more settled ranking.
      </p>

      <div aria-hidden="true" style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: -12 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="name"
              type="category"
              stroke={GRID}
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              dataKey="mu"
              type="number"
              stroke={GRID}
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 6,
                color: 'var(--ink)',
                fontSize: 12,
              }}
              cursor={{ stroke: 'var(--sage)' }}
            />
            <Scatter data={data} fill="var(--moss)" isAnimationActive={false}>
              <ErrorBar dataKey="sigma" stroke="var(--sage)" strokeWidth={2} width={4} direction="y" />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show data table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Ranking confidence: score and uncertainty per question</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 font-medium text-muted">Rank</th>
              <th scope="col" className="pr-3 font-medium text-muted">μ</th>
              <th scope="col" className="pr-3 font-medium text-muted">σ</th>
              <th scope="col" className="pr-3 font-medium text-muted">Comparisons</th>
              <th scope="col" className="font-medium text-muted">Question</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.rank}>
                <td className="pr-3 text-muted tabular-nums">#{it.rank}</td>
                <td className="pr-3 text-ink tabular-nums">{it.mu.toFixed(1)}</td>
                <td className="pr-3 text-ink tabular-nums">{it.sigma.toFixed(1)}</td>
                <td className="pr-3 text-ink tabular-nums">{it.nComparisons}</td>
                <td className="text-muted break-words">{it.canonicalText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  )
}
