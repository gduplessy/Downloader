import type { Inspection, EvidenceCandidate } from './policy';

export type PreviewBinding = {
  tabId: number;
  frameId: number;
  sessionKey: string;
  claimGeneration: number;
  documentGeneration: number;
  page: string;
  adapterId: string;
  adapterVersion: string;
  fingerprint: string;
};
export type Preview = { binding: PreviewBinding; candidates: EvidenceCandidate[] };
export function createPreview(binding: PreviewBinding, inspection: Inspection): Preview {
  return {
    binding: { ...binding },
    candidates: inspection.candidates
      .filter((c) => c.confidence !== 'rejected')
      .map((c) => ({ ...c })),
  };
}
export function validateSelection(
  preview: Preview,
  current: PreviewBinding,
  inspection: Inspection,
  localId: string,
): EvidenceCandidate {
  if (inspection.kind === 'user' || inspection.kind === 'wait')
    throw Error('adapter_preview_stale');
  for (const key of Object.keys(preview.binding) as (keyof PreviewBinding)[])
    if (preview.binding[key] !== current[key]) throw Error('adapter_preview_stale');
  const previous = preview.candidates.find((c) => c.localId === localId);
  const candidate = inspection.candidates.find(
    (c) => c.localId === localId && c.confidence !== 'rejected',
  );
  if (!previous || !candidate || JSON.stringify(previous) !== JSON.stringify(candidate))
    throw Error('adapter_preview_stale');
  return candidate;
}
// One authorization is consumed once, even if a caller retries a response.
export class SubmissionGate {
  private used = new Set<string>();
  consume(binding: PreviewBinding, localId: string): void {
    const key = JSON.stringify([binding, localId]);
    if (this.used.has(key)) throw Error('adapter_already_submitted');
    this.used.add(key);
  }
}
