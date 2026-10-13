import browser from 'webextension-polyfill';
import type { TransferPreview } from './transfer';
const words: Record<string, string[]> = {
  en: [
    'Receive session transfer',
    'Transfer code',
    'Destination session tab',
    'Reload tabs',
    'Preview transfer',
    'Accept in this session',
    'Clear preview',
    'Private session',
    'Regular session',
  ],
  fr: [
    'Recevoir le transfert de session',
    'Code de transfert',
    'Onglet de la session destinataire',
    'Actualiser les onglets',
    'Aperçu du transfert',
    'Accepter dans cette session',
    'Effacer l’aperçu',
    'Session privée',
    'Session normale',
  ],
  es: [
    'Recibir transferencia de sesión',
    'Código de transferencia',
    'Pestaña de la sesión de destino',
    'Actualizar pestañas',
    'Vista previa de transferencia',
    'Aceptar en esta sesión',
    'Borrar vista previa',
    'Sesión privada',
    'Sesión normal',
  ],
  de: [
    'Sitzungsübertragung empfangen',
    'Übertragungscode',
    'Tab der Zielsitzung',
    'Tabs aktualisieren',
    'Übertragung prüfen',
    'In dieser Sitzung annehmen',
    'Vorschau löschen',
    'Private Sitzung',
    'Normale Sitzung',
  ],
  ar: [
    'استقبال نقل الجلسة',
    'رمز النقل',
    'علامة تبويب الجلسة الوجهة',
    'تحديث علامات التبويب',
    'معاينة النقل',
    'قبول في هذه الجلسة',
    'مسح المعاينة',
    'جلسة خاصة',
    'جلسة عادية',
  ],
  'zh-CN': [
    '接收会话转移',
    '转移代码',
    '目标会话标签页',
    '刷新标签页',
    '预览转移',
    '在此会话中接受',
    '清除预览',
    '隐私会话',
    '普通会话',
  ],
};
export async function mountTransfer(container: HTMLElement, locale: string) {
  const t = words[locale] ?? words.en;
  const title = document.createElement('h2');
  title.textContent = t[0];
  const code = document.createElement('input');
  code.type = 'password';
  code.autocomplete = 'off';
  code.id = 'navigation-transfer-code';
  const codeLabel = document.createElement('label');
  codeLabel.htmlFor = code.id;
  codeLabel.textContent = t[1];
  const tabs = document.createElement('select');
  tabs.id = 'navigation-transfer-tab';
  const tabLabel = document.createElement('label');
  tabLabel.htmlFor = tabs.id;
  tabLabel.textContent = t[2];
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = t[3];
  const preview = document.createElement('button');
  preview.type = 'button';
  preview.textContent = t[4];
  preview.id = 'navigation-transfer-preview';
  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = t[5];
  accept.disabled = true;
  accept.id = 'navigation-transfer-accept';
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t[6];
  container.append(title, codeLabel, code, tabLabel, tabs, reload, preview, accept, clear, status);
  let previewId: string | undefined;
  let busy = false;
  async function discard() {
    const previous = previewId;
    previewId = undefined;
    accept.disabled = true;
    if (previous)
      await browser.runtime.sendMessage({
        type: 'navigation_transfer_discard',
        previewId: previous,
      });
  }
  async function refresh() {
    await discard();
    tabs.replaceChildren();
    for (const tab of await browser.tabs.query({})) {
      if (
        !tab.id ||
        !/^https?:\/\//.test(tab.url ?? '') ||
        Boolean(tab.incognito) !== Boolean(browser.extension.inIncognitoContext)
      )
        continue;
      const option = document.createElement('option');
      option.value = String(tab.id);
      option.textContent = `${tab.id}: ${tab.title ?? new URL(tab.url!).hostname}`;
      tabs.append(option);
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    preview.disabled = accept.disabled = true;
    code.disabled = tabs.disabled = reload.disabled = clear.disabled = true;
    try {
      await action();
    } catch (error) {
      status.textContent = String(error);
      await discard().catch(() => {});
    } finally {
      busy = false;
      preview.disabled = false;
      accept.disabled = !previewId;
      code.disabled = tabs.disabled = reload.disabled = clear.disabled = false;
    }
  }
  code.oninput = tabs.onchange = () => {
    void discard().catch(() => {});
  };
  reload.onclick = () => void run(refresh);
  clear.onclick = () =>
    void run(async () => {
      code.value = '';
      await discard();
      status.textContent = '';
    });
  preview.onclick = () =>
    void run(async () => {
      await discard();
      const value: TransferPreview & { preview_id: string } = await browser.runtime.sendMessage({
        type: 'navigation_transfer_preview',
        token: code.value.trim(),
        tabId: Number(tabs.value),
      });
      code.value = '';
      previewId = value.preview_id;
      status.textContent = `${value.filename} · ${value.page_url} · ${value.private ? t[7] : t[8]} · ${new Date(value.expires_at_ms).toLocaleString(locale)}`;
    });
  accept.onclick = () =>
    void run(async () => {
      const current = previewId;
      previewId = undefined;
      await browser.runtime.sendMessage({
        type: 'navigation_transfer_accept',
        previewId: current,
        consent: true,
      });
      status.textContent = t[5];
      code.value = '';
    });
  window.addEventListener(
    'pagehide',
    () => {
      code.value = '';
      void discard().catch(() => {});
    },
    { once: true },
  );
  await refresh();
}
