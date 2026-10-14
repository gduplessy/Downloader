import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { sameScope } from './scope';
export interface NavigationStartJob {
  id: string; request_id: string; source_generation: number; state: string;
  navigation_url?: string | null; page_url?: string | null;
  navigation_owner?: string | null; private: boolean;
  navigation_transfer_pending?: unknown; navigation_transfer_recovery?: boolean;
  navigation_scope?: SessionScope | null;
}
// Admission can wait. Only a fresh native snapshot may authorize the subsequent GET.
export async function admittedNavigationJob(expected: NavigationStartJob,
  admitted: () => Promise<boolean>, freshSnapshot: () => Promise<{ jobs: NavigationStartJob[] }>): Promise<boolean> {
  // The caller may retain and mutate its cached DTO while admission waits.
  expected = structuredClone(expected);
  if (!(await admitted())) return false;
  const current = (await freshSnapshot()).jobs.find(job => job.id === expected.id);
  const scopeMatches = current && (expected.navigation_scope && current.navigation_scope
    ? sameScope(expected.navigation_scope, current.navigation_scope)
    : !expected.navigation_scope && !current.navigation_scope);
  if (!current || !scopeMatches ||
      current.request_id !== expected.request_id || current.source_generation !== expected.source_generation ||
      current.navigation_url !== expected.navigation_url || current.page_url !== expected.page_url ||
      current.state !== expected.state || !['waiting_browser', 'waiting_user'].includes(current.state) ||
      current.navigation_owner !== expected.navigation_owner || current.private !== expected.private ||
      current.navigation_transfer_pending || current.navigation_transfer_recovery ||
      expected.navigation_transfer_pending || expected.navigation_transfer_recovery)
    throw Error('Navigation task changed during admission; retry from its current source');
  return true;
}
