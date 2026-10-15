import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { sameScope } from '../session/scope';
export interface CancelJob {
  id: string;
  navigation_scope?: SessionScope | null;
  source_generation: number;
}
export interface CancelRecord {
  tabId: number;
  scope?: SessionScope;
  sourceGeneration?: number;
}
export interface CancelActions<J extends CancelJob, R extends CancelRecord> {
  owner: string;
  native(command: string, args: Record<string, unknown>): Promise<unknown>;
  owns(record: R): Promise<boolean>;
  invalidate(job: J): Promise<void>;
  release(id: string): Promise<void>;
  removeRecord(id: string): Promise<void>;
  closeTab(tabId: number): Promise<void>;
}
/** Commit the native terminal fence before touching browser source/lease/tab state. */
export async function cancelNavigationTask<J extends CancelJob, R extends CancelRecord>(
  job: J,
  record: R | undefined,
  actions: CancelActions<J, R>,
): Promise<void> {
  if (job.navigation_scope) {
    if (
      !record?.scope ||
      !sameScope(record.scope, job.navigation_scope) ||
      record.sourceGeneration !== job.source_generation ||
      record.scope.profile !== actions.owner ||
      !(await actions.owns(record))
    )
      throw Error('Cancellation requires the current owning browser session');
    await actions.native('cancel_navigation', {
      id: job.id,
      owner: actions.owner,
      scope: record.scope,
      source_generation: record.sourceGeneration,
    });
  } else
    await actions.native('cancel_navigation', {
      id: job.id,
      owner: actions.owner,
      scope: null,
      source_generation: job.source_generation,
    });
  await actions.invalidate(job);
  await actions.release(job.id);
  await actions.removeRecord(job.id);
  // Recheck actual tab scope after the asynchronous native commit and cleanup.
  if (record && (await actions.owns(record))) await actions.closeTab(record.tabId);
}
