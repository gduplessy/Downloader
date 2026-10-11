import type { ChallengeBinding } from './lifecycle';
import type { SessionScope } from '../../../../../packages/shared/src/navigation';
type OwnedChallengeContext = {
  tabId: number;
  frameId: number;
  scope: SessionScope;
  sourceGeneration: number;
  documentGeneration: number;
  page: string;
  selectedHost: string;
};
export type ChallengeDependencies = {
  owned(tabId: number): Promise<OwnedChallengeContext | null>;
  authorizeSite(tabId: number): Promise<boolean>;
  native(args: {
    id: string;
    owner: string;
    scope: SessionScope;
    source_generation: number;
    request: any;
  }): Promise<any>;
  jobId(tabId: number): Promise<string | null>;
  now(): number;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function challengeHandler(deps: ChallengeDependencies) {
  const used = new Set<string>();
  async function validate(
    sender: { tabId: number; frameId: number; page: string },
    binding: ChallengeBinding,
  ) {
    const owned = await deps.owned(sender.tabId);
    if (
      !owned ||
      sender.frameId !== 0 ||
      owned.frameId !== 0 ||
      sender.page !== binding.page ||
      owned.page !== binding.page ||
      !same(owned.scope, binding.scope) ||
      owned.sourceGeneration !== binding.sourceGeneration ||
      owned.documentGeneration !== binding.documentGeneration ||
      owned.selectedHost !== binding.selectedHost ||
      !binding.selectedHost ||
      deps.now() >= binding.expiresAt ||
      binding.expiresAt > deps.now() + 10 * 60 * 1000 ||
      !/^([a-f0-9]{64})$/.test(binding.imageDigest) ||
      !/^([a-f0-9]{64})$/.test(binding.csrfDigest)
    )
      throw Error('challenge_session_rejected');
    return owned;
  }
  return {
    async authorize(
      sender: { tabId: number; frameId: number; page: string },
      binding: ChallengeBinding,
    ) {
      const owned = await validate(sender, binding);
      const key = JSON.stringify(binding);
      if (used.has(key) || !(await deps.authorizeSite(owned.tabId))) return false;
      // Revalidate after the asynchronous scheduler/site authorization.
      await validate(sender, binding);
      used.add(key);
      return true;
    },
    async paid(
      sender: { tabId: number; frameId: number; page: string },
      binding: ChallengeBinding,
      request: {
        action: 'start' | 'poll' | 'cancel';
        image?: { image_base64: string; instruction: string; width: number; height: number };
      },
    ) {
      const owned = await validate(sender, binding);
      if (owned.scope.private) throw Error('captcha_private_external_refused');
      const id = await deps.jobId(sender.tabId);
      if (!id) throw Error('captcha_session_rejected');
      const digest = Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(binding))),
        ),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      if (!['start', 'poll', 'cancel'].includes(request.action))
        throw Error('captcha_invalid_action');
      if (
        request.action === 'start' &&
        (!request.image ||
          request.image.instruction !== 'Click the open circle' ||
          request.image.image_base64.length > 800000 ||
          request.image.width < 1 ||
          request.image.height < 1 ||
          request.image.width > 1000 ||
          request.image.height > 1000)
      )
        throw Error('captcha_invalid_image');
      await validate(sender, binding);
      return deps.native({
        id,
        owner: owned.scope.profile,
        scope: owned.scope,
        source_generation: owned.sourceGeneration,
        request:
          request.action === 'start'
            ? { action: 'start', image: { ...request.image, binding: digest } }
            : { action: request.action, binding: digest },
      });
    },
  };
}
