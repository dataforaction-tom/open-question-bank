'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from './Button'
import { Card } from './Card'
import { Textarea } from './Field'
import { Notice } from './Notice'
import { Stamp } from './Stamp'

interface SynthesisRow {
  id: string
  synthesisedText: string
  sourceQuestionIds: string[]
  rationale: string
  version: number
  proposedBy: string
  endorsedBy: string[]
  status: string
}

export function SynthesisPanel({ campaignId }: { campaignId: string }) {
  const [rows, setRows] = useState<SynthesisRow[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/campaigns/${campaignId}/syntheses`)
      if (res.ok) setRows((await res.json()).syntheses)
      else setMessage('Could not load syntheses.')
    } catch {
      setMessage('Network error — please try again.')
    }
  }, [campaignId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function send(url: string, body?: object) {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        setMessage((await res.json()).error ?? 'Action failed.')
        return
      }
      setEditId(null)
      await load()
    } catch {
      setMessage('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  const base = `/api/admin/campaigns/${campaignId}/syntheses`
  const visible = rows.filter((r) => r.status === 'proposed')

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">Synthesis</p>
        <Button type="button" onClick={() => send(base)} disabled={busy}>
          Propose syntheses
        </Button>
      </div>

      {message && (
        <Notice role="alert" tone="error">
          {message}
        </Notice>
      )}

      {visible.length === 0 ? (
        <p className="text-muted">No proposals yet.</p>
      ) : (
        <ul className="space-y-3 list-none p-0">
          {visible.map((r) => (
            <li key={r.id}>
              <Card className="space-y-2">
                <p className="text-ink">{r.synthesisedText}</p>
                <Stamp>
                  {r.rationale} · {r.sourceQuestionIds.length} sources · v{r.version}
                  {r.endorsedBy.length > 0 ? ' · endorsed' : ''}
                </Stamp>
                {editId === r.id ? (
                  <div className="space-y-2">
                    <Textarea
                      aria-label="Edit synthesis text"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => send(`${base}/${r.id}/edit`, { text: editText })} disabled={busy}>
                        Save edit
                      </Button>
                      <Button type="button" variant="quiet" onClick={() => setEditId(null)} disabled={busy}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => send(`${base}/${r.id}/endorse`)} disabled={busy}>
                      Endorse
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setEditId(r.id)
                        setEditText(r.synthesisedText)
                      }}
                      disabled={busy}
                    >
                      Edit
                    </Button>
                    <Button type="button" variant="quiet" onClick={() => send(`${base}/${r.id}/reject`)} disabled={busy}>
                      Reject
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
