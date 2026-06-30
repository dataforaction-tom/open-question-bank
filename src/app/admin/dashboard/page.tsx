import { AdminShell } from '@/components/ui/AdminShell'
import { Card } from '@/components/ui/Card'
import { ChartCard } from '@/components/charts/ChartCard'
import { QuestionGraph } from '@/components/charts/QuestionGraph'
import {
  clusterSizes,
  comparisonsByDay,
  definednessBands,
  pipelineTotals,
  questionStateCounts,
  refinementsByDay,
  submissionsByDay,
} from '@/lib/analytics'
import { questionGraph } from '@/lib/browse'

// Reads live data on each request; never statically generated (no DB at build).
export const dynamic = 'force-dynamic'

// Presentation-only: humanises the raw `question.state` enum values for the "Questions by
// stage" chart. The underlying state machine and STATE_ORDER in analytics.ts are unchanged.
const STATE_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  flagged: 'Flagged',
  rejected: 'Rejected',
  merged_as_variant: 'Merged as duplicate',
  clustered: 'Grouped',
  canonical: 'Ready',
  under_comparison: 'Being compared',
  ranked: 'Ranked',
  synthesised: 'Summarised',
  archived: 'Archived',
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="space-y-1">
      <div className="font-display text-3xl text-moss tabular-nums">{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </Card>
  )
}

export default async function AdminDashboardPage() {
  // Workspace-scoped (active workspace). Fetched in parallel.
  const [totals, submissions, states, comparisons, refinements, bands, clusters, graph] = await Promise.all([
    pipelineTotals(),
    submissionsByDay(30),
    questionStateCounts(),
    comparisonsByDay(30),
    refinementsByDay(30),
    definednessBands(),
    clusterSizes(10),
    questionGraph(200),
  ])

  return (
    <AdminShell>
      <div className="space-y-1">
        <p className="eyebrow">Overview</p>
        <h1 className="text-3xl">Pipeline health</h1>
        <p className="text-muted">A quick look at how many questions are at each stage.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Questions" value={totals.questions} />
        <Stat label="Awaiting moderation" value={totals.pending} />
        <Stat label="Ready" value={totals.canonical} />
        <Stat label="Ranked" value={totals.ranked} />
        <Stat label="Campaigns" value={totals.campaigns} />
        <Stat label="Comparisons" value={totals.comparisons} />
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <ChartCard title="Submissions (last 30 days)" data={submissions} kind="line" color="var(--moss)" valueLabel="Submissions" empty="No submissions in the last 30 days." />
        <ChartCard
          title="Questions by stage"
          data={states.map((s) => ({ ...s, label: STATE_LABELS[s.label] ?? s.label }))}
          kind="bar"
          color="var(--moss)"
          valueLabel="Questions"
        />
        <ChartCard title="Comparisons (last 30 days)" data={comparisons} kind="line" color="var(--clay)" valueLabel="Comparisons" empty="No comparisons in the last 30 days." />
        <ChartCard title="Refinements (last 30 days)" data={refinements} kind="line" color="var(--clay)" valueLabel="Refinements" empty="No refinements in the last 30 days." />
        <ChartCard title="Quality scores" data={bands} kind="bar" color="var(--sage)" valueLabel="Questions" empty="No scored questions yet." />
        <ChartCard title="Biggest question groups" data={clusters} kind="bar" color="var(--sage)" valueLabel="Questions" empty="No groups yet." />
      </div>

      <QuestionGraph nodes={graph.nodes} edges={graph.edges} />
    </AdminShell>
  )
}
