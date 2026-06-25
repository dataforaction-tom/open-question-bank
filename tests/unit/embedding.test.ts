import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ollama', () => ({
  embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))
vi.mock('@/lib/dataset-version', () => ({
  getActiveDatasetVersion: vi.fn().mockResolvedValue({
    id: 1,
    workspaceId: '00000000-0000-0000-0000-000000000001',
    embeddingModel: 'nomic-embed-text',
    embeddingModelDigest: 'sha256:abc',
    embeddingDim: 768,
    dedupThreshold: 0.15,
    isActive: true,
    createdAt: new Date(),
  }),
}))

import { embedForActiveVersion } from '@/lib/embedding'
import { embed } from '@/lib/ollama'

afterEach(() => vi.clearAllMocks())

describe('embedForActiveVersion', () => {
  it('embeds with the active model and stamps the model-version digest', async () => {
    const result = await embedForActiveVersion('what is resilience?')

    expect(embed).toHaveBeenCalledWith('what is resilience?', 'nomic-embed-text')
    expect(result.embedding).toEqual([0.1, 0.2, 0.3])
    expect(result.embeddingModelVersion).toBe('nomic-embed-text@sha256:abc')
    expect(result.datasetVersionId).toBe(1)
    expect(result.workspaceId).toBe('00000000-0000-0000-0000-000000000001')
    expect(result.dedupThreshold).toBe(0.15)
  })
})
