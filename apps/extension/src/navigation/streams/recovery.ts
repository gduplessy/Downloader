import type { StreamIdentity } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';

/** Recovery may terminate only the exact current stream; it never creates a reader. */
export function orphanedStreamIdentity(
  capture: any, record: any, job: any, epoch: string,
): StreamIdentity | null {
  if (!capture?.scope || !record?.scope || !job?.navigation_scope
      || record.sessionEpoch !== epoch || capture.tabId !== record.tabId
      || !['armed', 'taking_original_response', 'streaming', 'interrupted', 'detached'].includes(capture.state)
      || (['interrupted', 'detached'].includes(capture.state) && job.state !== 'browser_downloading')
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

/** A locally stopped reader is not proof that its native abort was durably accepted. */
export async function recoverStreamAbort(
  capture: {state: string}, identity: StreamIdentity,
  abort: (identity: StreamIdentity) => Promise<unknown>, nativeState = 'browser_downloading',
): Promise<void> {
  try { await abort(identity); }
  catch (error) {
    // An armed response may never have admitted a native checkpoint. A stopped
    // reader with native BrowserDownloading must retry its exact abort after reconnect.
    if (capture.state !== 'armed' || nativeState !== 'waiting_browser'
        || !String(error).includes('Browser stream not begun')) throw error;
  }
}
