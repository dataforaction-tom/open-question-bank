import Link from 'next/link'
import { PageShell } from '@/components/ui/PageShell'
import { buttonClasses } from '@/components/ui/Button'

export default function Home() {
  return (
    <PageShell>
      <div className="space-y-3">
        <p className="eyebrow">A collective instrument</p>
        <h1 className="text-4xl sm:text-5xl leading-[1.05]">
          Better questions, prioritised in the open.
        </h1>
      </div>

      <p className="text-lg leading-relaxed text-muted max-w-prose">
        Take a messy pool of submitted questions and produce a trustworthy, versioned,
        synthesised agenda — every transformation logged, auditable, and open.
      </p>

      <div>
        <Link href="/submit" className={buttonClasses('accent')}>
          Submit a question →
        </Link>
      </div>
    </PageShell>
  )
}
