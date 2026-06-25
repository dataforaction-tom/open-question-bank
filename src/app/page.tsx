import Link from 'next/link'
import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { buttonClasses } from '@/components/ui/Button'

export default function Home() {
  return (
    <PageShell nav={<PublicNav />}>
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

      <div className="flex flex-wrap gap-3">
        <Link href="/submit" className={buttonClasses('accent')}>
          Submit a question →
        </Link>
        <Link href="/browse" className={buttonClasses('ghost')}>
          Search the bank
        </Link>
        <Link href="/campaigns" className={buttonClasses('ghost')}>
          Browse campaigns
        </Link>
      </div>
    </PageShell>
  )
}
