import type { SessionScope } from '../../../../../packages/shared/src/navigation';
import { sessionKey } from './scope';

export type BrowserProjection = { owner: string; private: boolean; scopes: SessionScope[] };
export type ProjectionTicket = { key: string; after_sequence: number | null };

// An incremental cursor is valid only for the exact authority projection that
// produced its cached snapshot. A new claim must recover a fresh snapshot.
export class ProjectionCursor {
  private key?: string;

  prepare(projection: BrowserProjection, afterSequence: number | null): ProjectionTicket {
    const key = JSON.stringify({
      owner: projection.owner,
      private: projection.private,
      scopes: projection.scopes
        .map((scope) => JSON.stringify([sessionKey(scope), scope.claim_generation]))
        .sort(),
    });
    return { key, after_sequence: key === this.key ? afterSequence : null };
  }

  accept(ticket: ProjectionTicket): void {
    this.key = ticket.key;
  }
}
