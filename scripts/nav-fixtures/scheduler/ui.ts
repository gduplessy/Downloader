import { mountSchedulerControls } from '../../../apps/extension/src/navigation/scheduler/ui';
const global = globalThis as any;
global.fixtureActions = [];
global.fixtureSnapshot = null;
global.chrome = { runtime: { id: 'scheduler-fixture' } };
global.browser = {
  runtime: { id: 'scheduler-fixture', sendMessage: async (message: any) => {
    global.fixtureActions.push(message);
    const response = await fetch('/command', { method: 'POST', body: JSON.stringify(message) });
    const value = await response.json();
    if (!value.ok) throw Error(value.error);
    global.fixtureSnapshot = value.data; return value.data;
  } },
  permissions: { request: async () => false },
};
void mountSchedulerControls(document.getElementById('queue')!, new URL(location.href).searchParams.get('locale') ?? 'en');
