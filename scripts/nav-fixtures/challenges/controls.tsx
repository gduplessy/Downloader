import { createRoot } from 'react-dom/client';
import { SettingsPage } from '../../../apps/desktop/src/App';
import { translate, type Locale } from '../../../packages/shared/src/i18n';
async function command(command: string, args?: unknown) {
  const response = await fetch('/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
const state = await fetch('/state').then((r) => r.json());
const root = createRoot(document.getElementById('root')!);
root.render(
  <SettingsPage settings={state.settings} t={(key) => translate('en', key)} run={command} />,
);
async function wait(check: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    if (Date.now() > deadline) throw Error('Control state deadline');
    await new Promise((r) => setTimeout(r, 25));
  }
}
const panel = () =>
  Array.from(document.querySelectorAll('fieldset')).find(
    (f) => f.querySelector('legend')?.textContent === 'FlareSolverr',
  )!;
const input = (selector: string) => panel().querySelector<HTMLInputElement>(selector)!;
function change(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
(globalThis as any).runSolverControls = async () => {
  await wait(() => !!panel());
  input('input[type=checkbox]').click();
  await new Promise((r) => setTimeout(r, 25));
  document.querySelector('form')!.requestSubmit();
  await wait(() => document.querySelector('form > button.primary')?.textContent === 'Saved');
  const saved = await fetch('/state').then((r) => r.json());
  if (!saved.settings.solver.enabled) throw Error('Enable/save did not reach native engine');
  const test = Array.from(panel().querySelectorAll('button')).find(
    (b) => b.textContent === 'Test connection',
  )!;
  test.click();
  await wait(() => panel().textContent!.includes('Service ready.'));
  const endpoint = input('input[type=url]'),
    original = endpoint.value;
  change(endpoint, original.replace('127.0.0.1', 'localhost'));
  await wait(() => !panel().textContent!.includes('Service ready.'));
  input('input[type=checkbox]').click();
  await new Promise((r) => setTimeout(r, 25));
  document.querySelector('form')!.requestSubmit();
  await wait(() => document.querySelector('form > button.primary')?.textContent === 'Saved');
  const restarted = await command('restart');
  if (restarted.settings.solver.enabled) throw Error('Disable/save/restart did not persist');
  return {
    fixture: 'production-solver-settings-native-cli-v1',
    enable_save: true,
    test_connection: true,
    changed_setting_invalidates_result: true,
    disable_save_restart: true,
    paid_budget: restarted.settings.captcha.total_budget_microusd,
    browser: navigator.userAgent,
    qualification:
      'Production React settings controls and real isolated CLI/native service; fake local FlareSolverr health, no clearance claim or installed native window observation.',
  };
};
