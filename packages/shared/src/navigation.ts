// Shared navigation metadata. Request secrets and challenge images are transient.
export const NATIVE_FRAME_LIMIT = 1024 * 1024;
export const STREAM_CHUNK_BYTES = 192 * 1024;

export type SessionScope = {
  browser: string;
  profile: string;
  private: boolean;
  cookie_store_id: string | null;
  container_id: string | null;
  partition_key: { top_level_site: string; has_cross_site_ancestor?: boolean } | null;
  claim_generation: number;
};

export type NavigationTarget = { kind: 'job' | 'project'; id: string };
export type NavigationStatus =
  | 'waiting_admission'
  | 'active'
  | 'waiting_site'
  | 'waiting_user'
  | 'waiting_browser'
  | 'streaming'
  | 'complete'
  | 'cancelled'
  | 'failed';
export type WaitMetadata = {
  observed_at: string;
  ready_at: string | null;
  recheck_at: string;
  expires_at: string | null;
  basis: 'server' | 'page' | 'retry_after';
  tab_requirement: 'live' | 'recreatable';
};
export type NavigationTask = {
  id: string;
  target: NavigationTarget;
  purpose: 'navigation' | 'discovery';
  scope: SessionScope;
  source_generation: number;
  source_origin: string;
  selected_host: string | null;
  adapter_id: string;
  adapter_version: string;
  status: NavigationStatus;
  reason: string | null;
  wait: WaitMetadata | null;
};
export type ReplayDecision = {
  disposition: 'replayable' | 'browser_stream_only' | 'refresh_required' | 'unknown';
  reason: string;
  source_generation: number;
};
export type StreamIdentity = {
  stream_id: string;
  scope: SessionScope;
  source_generation: number;
};
export type StreamOperation = StreamIdentity &
  (
    | { operation: 'begin'; target: NavigationTarget; filename: string; total: number | null }
    | { operation: 'chunk'; offset: number; data_base64: string }
    | { operation: 'end'; total: number; expected_sha256: string | null }
    | { operation: 'abort'; reason: string }
  );
export type StreamAck = {
  stream_id: string;
  accepted_offset: number;
  claim_generation: number;
  source_generation: number;
  terminal: boolean;
};
