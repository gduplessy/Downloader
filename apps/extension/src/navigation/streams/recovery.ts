import type { StreamIdentity } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';

/** Recovery may terminate only the exact current stream; it never creates a reader. */
export function orphanedStreamIdentity(
  capture: any, record: any, job: any, epoch: string,
): StreamIdentity | null {
  if (!capture?.scope || !record?.scope || !job?.navigation_scope
      || record.sessionEpoch !== epoch || capture.tabId !== record.tabId
      || !['armed', 'taking_original_response', 'streaming'].includes(capture.state)
      || !['waiting_browser', 'browser_downloading', 'waiting_user'].includes(job.state)
      || !job.browser_source || !Number.isSafeInteger(capture.sourceGeneration)
      || capture.sourceGeneration < 1
      || capture.sourceGeneration !== record.sourceGeneration
      || capture.sourceGeneration !== job.source_generation
      || !sameScope(capture.scope, record.scope)
      || !sameScope(capture.scope, job.navigation_scope)
      || job.navigation_owner !== capture.scope.profile
      || typeof capture.streamId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capture.streamId))
    return null;
  return {stream_id: capture.streamId, scope: capture.scope, source_generation: capture.sourceGeneration};
}
