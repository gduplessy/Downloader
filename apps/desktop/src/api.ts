import { invoke, isTauri } from '@tauri-apps/api/core';
export async function api<T = unknown>(command: string, args?: unknown): Promise<T> {
  if (!isTauri()) throw Error('Open the desktop app to connect to the download engine.');
  return invoke<T>('request', {
    command: { command, ...(args === undefined ? {} : { args }) },
  });
}
export async function pickDirectory(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ directory: true, multiple: false });
  return typeof path === 'string' ? path : null;
}
export async function fileAction(id: string, reveal = false) {
  return invoke('file_action', { id, reveal });
}
