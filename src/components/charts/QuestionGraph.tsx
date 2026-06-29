'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'

// ---- Types (mirror the API response) ----

interface GraphNode {
  id: string
  canonicalText: string
  state: string
  theme: string | null
  clusterId: string | null
  variantCount: number
}
interface GraphEdge {
  source: string
  target: string
  clusterId: string
}

// ---- Theme colours (palette-derived, one per theme + a neutral for unsorted) ----

const THEME_COLORS: Record<string, string> = {
  'Transport & Streets': '#c2542a', // clay
  'Housing': '#7fb79a',            // moss-light
  'Climate & Environment': '#3a7d5c', // moss-deep
  'Health & Care': '#9a6b8a',      // plum
  'Youth & Education': '#b8954a',  // ochre
  'Local Economy': '#5a8ab8',      // steel-blue
  'Community & Belonging': '#d47a4a', // warm-orange
  'Democracy & Voice': '#6a7b9a',  // slate-blue
  'Digital & Services': '#4a9a8a', // teal
  Unsorted: '#8aa293',             // sage
}

const NEUTRAL_NODE = 'var(--sage)'

function colorForTheme(theme: string | null): string {
  if (theme && THEME_COLORS[theme]) return THEME_COLORS[theme]
  return NEUTRAL_NODE
}

// ---- Force simulation (simple, deterministic, runs in useEffect) ----

interface SimNode {
  id: string
  text: string
  theme: string | null
  variantCount: number
  color: string
  x: number
  y: number
  vx: number
  vy: number
  clusterId: string | null
}

interface SimEdge {
  source: string
  target: string
}

const WIDTH = 600
const HEIGHT = 400
const CHARGE = -120     // repulsion strength
const LINK_DIST = 50    // spring rest length
const DAMPING = 0.85    // velocity damping per tick
const CENTER_FORCE = 0.02
const MAX_TICKS = 200

function simulate(nodes: SimNode[], edges: SimEdge[]): SimNode[] {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set())
    if (!adj.has(e.target)) adj.set(e.target, new Set())
    adj.get(e.source)!.add(e.target)
    adj.get(e.target)!.add(e.source)
  }

  // Deterministic initial placement: circle around center, seeded by index.
  const cx = WIDTH / 2
  const cy = HEIGHT / 2
  const radius = Math.min(WIDTH, HEIGHT) / 3
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2
    n.x = cx + Math.cos(angle) * radius
    n.y = cy + Math.sin(angle) * radius
    n.vx = 0
    n.vy = 0
  })

  for (let tick = 0; tick < MAX_TICKS; tick++) {
    // Charge repulsion (O(n²) but capped by maxNodes).
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = a.x - b.x
        const dy = a.y - b.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) dist2 = 1
        const dist = Math.sqrt(dist2)
        const force = CHARGE / dist2
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }

    // Link spring (attract connected nodes to rest length).
    for (const e of edges) {
      const a = nodes.find((n) => n.id === e.source)
      const b = nodes.find((n) => n.id === e.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = (dist - LINK_DIST) * 0.05
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Centering + apply velocity + damping + boundary.
    for (const n of nodes) {
      n.vx += (cx - n.x) * CENTER_FORCE
      n.vy += (cy - n.y) * CENTER_FORCE
      n.vx *= DAMPING
      n.vy *= DAMPING
      n.x += n.vx
      n.y += n.vy
      // Keep within bounds.
      n.x = Math.max(20, Math.min(WIDTH - 20, n.x))
      n.y = Math.max(20, Math.min(HEIGHT - 20, n.y))
    }
  }

  return nodes
}

function nodeRadius(variantCount: number): number {
  // Base 4, +1 per 2 variants (capped). Community demand = bigger node.
  return Math.min(10, 4 + Math.floor(variantCount / 2))
}

// ---- Component ----

export interface QuestionGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Base URL for clicking a node — defaults to /questions/[id]. */
  linkPrefix?: string
}

export function QuestionGraph({ nodes: rawNodes, edges: rawEdges, linkPrefix = '/questions' }: QuestionGraphProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const router = useRouter()

  // Run the force simulation — pure function of input data, no side effects.
  const simNodes = useMemo<SimNode[]>(() => {
    if (rawNodes.length === 0) return []
    const simInput: SimNode[] = rawNodes.map((n) => ({
      id: n.id,
      text: n.canonicalText,
      theme: n.theme,
      variantCount: n.variantCount,
      color: colorForTheme(n.theme),
      x: 0, y: 0, vx: 0, vy: 0,
      clusterId: n.clusterId,
    }))
    const simEdges: SimEdge[] = rawEdges.map((e) => ({ source: e.source, target: e.target }))
    return simulate(simInput, simEdges)
  }, [rawNodes, rawEdges])

  // Build adjacency for hover highlighting.
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>()
    for (const e of rawEdges) {
      if (!adj.has(e.source)) adj.set(e.source, new Set())
      if (!adj.has(e.target)) adj.set(e.target, new Set())
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
    return adj
  }, [rawEdges])

  const isHighlighted = (id: string): boolean => {
    if (!hovered) return false
    if (id === hovered) return true
    return adjacency.get(hovered)?.has(id) ?? false
  }

  const isEdgeHighlighted = (e: GraphEdge): boolean => {
    if (!hovered) return false
    return e.source === hovered || e.target === hovered
  }

  const nodeById = useMemo(() => {
    const map = new Map<string, SimNode>()
    simNodes.forEach((n) => map.set(n.id, n))
    return map
  }, [simNodes])

  if (rawNodes.length === 0) {
    return (
      <Card className="space-y-3">
        <p className="eyebrow">Question relationships</p>
        <p className="text-sm text-muted">No published questions yet.</p>
      </Card>
    )
  }

  return (
    <Card className="space-y-3">
      <p className="eyebrow">Question relationships</p>
      <p className="text-sm text-muted">
        Each circle is a published question, coloured by theme and sized by community demand.
        Lines connect questions that cluster together by semantic similarity.
        Hover to highlight connections; click a question to open it.
      </p>

      <div aria-hidden="true" style={{ width: '100%', maxWidth: WIDTH, margin: '0 auto' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          style={{ width: '100%', height: 'auto', display: 'block' }}
          role="img"
          aria-label="Network graph of questions grouped by theme and similarity"
        >
          {/* Edges */}
          {rawEdges.map((e, i) => {
            const a = nodeById.get(e.source)
            const b = nodeById.get(e.target)
            if (!a || !b) return null
            const highlighted = isEdgeHighlighted(e)
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={highlighted ? 'var(--moss)' : 'var(--line)'}
                strokeWidth={highlighted ? 2 : 1}
                opacity={hovered && !highlighted ? 0.2 : 0.6}
              />
            )
          })}

          {/* Nodes */}
            {simNodes.map((n) => {
              const r = nodeRadius(n.variantCount)
              const highlighted = isHighlighted(n.id)
              const dimmed = hovered && !highlighted
              return (
                <g
                  key={n.id}
                  onMouseEnter={() => setHovered(n.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => router.push(`${linkPrefix}/${n.id}`)}
                  style={{ cursor: 'pointer', opacity: dimmed ? 0.3 : 1 }}
                >
                  <circle
                    cx={n.x} cy={n.y} r={r}
                    fill={n.color}
                    stroke={highlighted ? 'var(--ink)' : 'none'}
                    strokeWidth={highlighted ? 2 : 0}
                  />
                  {highlighted && (
                    <title>{n.text}</title>
                  )}
                </g>
              )
            })}
        </svg>
      </div>

      {/* Theme legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(THEME_COLORS).map(([theme, color]) => {
          const count = rawNodes.filter((n) => (n.theme ?? 'Unsorted') === theme).length
          if (count === 0) return null
          return (
            <span key={theme} className="inline-flex items-center gap-1.5 text-muted">
              <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              {theme} ({count})
            </span>
          )
        })}
      </div>

      {/* Accessible data table */}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Show data table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Question relationships: theme, cluster, and community demand per question</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 font-medium text-muted">Question</th>
              <th scope="col" className="pr-3 font-medium text-muted">Theme</th>
              <th scope="col" className="pr-3 font-medium text-muted">Cluster</th>
              <th scope="col" className="pr-3 font-medium text-muted">Demand</th>
              <th scope="col" className="font-medium text-muted">Links</th>
            </tr>
          </thead>
          <tbody>
            {rawNodes.map((n) => {
              const links = adjacency.get(n.id)?.size ?? 0
              return (
                <tr key={n.id}>
                  <td className="pr-3 text-muted break-words max-w-xs">{n.canonicalText}</td>
                  <td className="pr-3 text-ink">{n.theme ?? 'Unsorted'}</td>
                  <td className="pr-3 text-ink tabular-nums">{n.clusterId ? 'Yes' : '—'}</td>
                  <td className="pr-3 text-ink tabular-nums">{n.variantCount}</td>
                  <td className="text-ink tabular-nums">{links}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </details>
    </Card>
  )
}