import { PageShell } from '@/components/ui/PageShell'
import { PublicNav } from '@/components/ui/PublicNav'
import { SubmitForm } from '@/components/SubmitForm'

export default function SubmitPage() {
  return (
    <PageShell nav={<PublicNav />}>
      <div className="space-y-2">
        <p className="eyebrow">Add to the bank</p>
        <h1 className="text-3xl sm:text-4xl">Submit a question</h1>
      </div>
      <SubmitForm />
    </PageShell>
  )
}
