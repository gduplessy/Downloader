import { NavigationStarts } from '../session/start';
import { sameScope } from '../session/scope';

/** Order native interruption and resolver navigation writes for one owning tab. */
export class CaptureTransitions {
  private serial = new NavigationStarts();
  run<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    return this.serial.run(String(tabId), operation);
  }
}
export function interruptedCaptureMatches(capture: any, record: any): boolean {
  return Boolean(
    capture?.scope &&
    record?.scope &&
    sameScope(capture.scope, record.scope) &&
    capture.sourceGeneration === record.sourceGeneration &&
    capture.documentNonce === record.documentNonce &&
    ['interrupted', 'detached'].includes(capture.state),
  );
}
