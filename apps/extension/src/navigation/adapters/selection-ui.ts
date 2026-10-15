import type { Preview } from './preview';
const messages = {
  en: [
    'Choose download control',
    'Select the intended file host and action. Premium, advertising and unsafe controls are excluded.',
    'Continue',
    'Cancel',
    'Refresh',
    'Page changed. Refresh the selection.',
    'Destination',
    'Action',
    'Group',
  ],
  fr: [
    'Choisir le téléchargement',
    'Choisissez l’hébergeur et l’action. Les contrôles premium, publicitaires et dangereux sont exclus.',
    'Continuer',
    'Annuler',
    'Actualiser',
    'La page a changé. Actualisez la sélection.',
    'Destination',
    'Action',
    'Groupe',
  ],
  es: [
    'Elegir la descarga',
    'Seleccione el servidor y la acción. Se excluyen controles premium, anuncios y controles inseguros.',
    'Continuar',
    'Cancelar',
    'Actualizar',
    'La página cambió. Actualice la selección.',
    'Destino',
    'Acción',
    'Grupo',
  ],
  de: [
    'Download auswählen',
    'Wählen Sie Dateihost und Aktion. Premium, Werbung und unsichere Elemente sind ausgeschlossen.',
    'Weiter',
    'Abbrechen',
    'Aktualisieren',
    'Seite geändert. Auswahl aktualisieren.',
    'Ziel',
    'Aktion',
    'Gruppe',
  ],
  ar: [
    'اختر التنزيل',
    'اختر مضيف الملف والإجراء. تُستبعد الإعلانات والعناصر المدفوعة وغير الآمنة.',
    'متابعة',
    'إلغاء',
    'تحديث',
    'تغيرت الصفحة. حدّث الاختيار.',
    'الوجهة',
    'الإجراء',
    'المجموعة',
  ],
  'zh-CN': [
    '选择下载',
    '选择文件主机和操作。付费、广告和不安全的控件已排除。',
    '继续',
    '取消',
    '刷新',
    '页面已更改。请刷新选择。',
    '目标',
    '操作',
    '组',
  ],
} as const;
const actionLabels: Record<string, Record<string, string>> = {
  en: { link: 'Follow link', GET: 'GET download', POST: 'POST download', script: 'Browser action' },
  fr: {
    link: 'Suivre le lien',
    GET: 'Téléchargement GET',
    POST: 'Téléchargement POST',
    script: 'Action du navigateur',
  },
  es: {
    link: 'Seguir enlace',
    GET: 'Descarga GET',
    POST: 'Descarga POST',
    script: 'Acción del navegador',
  },
  de: { link: 'Link folgen', GET: 'GET-Download', POST: 'POST-Download', script: 'Browseraktion' },
  ar: { link: 'اتباع الرابط', GET: 'تنزيل GET', POST: 'تنزيل POST', script: 'إجراء المتصفح' },
  'zh-CN': { link: '打开链接', GET: 'GET 下载', POST: 'POST 下载', script: '浏览器操作' },
};
export type PreviewHandle = { close(): void; stale(): void; signal: AbortSignal };
export function showPreview(
  document: Document,
  preview: Preview,
  locale: string,
  select: (id: string, signal: AbortSignal) => Promise<void>,
  refresh: () => void,
  disableAdapter?: () => Promise<void>,
): PreviewHandle {
  document.getElementById('__downloader_adapter_preview')?.remove();
  const words = messages[locale as keyof typeof messages] ?? messages.en;
  const previous = document.activeElement as HTMLElement | null;
  const lifetime = new AbortController();
  const host = document.createElement('div');
  host.id = '__downloader_adapter_preview';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent =
    ':host{position:fixed!important;inset:0!important;z-index:2147483647!important;background:#0009!important;font:16px system-ui!important;color:#132139!important}section{background:white;margin:8vh auto;padding:24px;width:min(650px,80vw);max-height:76vh;overflow:auto;border-radius:8px}label{display:block;padding:12px;border:1px solid #9ba7b8;margin:8px 0}button{margin:12px 8px 0 0;padding:10px}p{line-height:1.4}input:focus-visible,button:focus-visible{outline:3px solid #185ac5;outline-offset:3px}';
  root.append(style);
  const panel = document.createElement('section');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'preview-title');
  panel.dir = locale === 'ar' ? 'rtl' : 'ltr';
  const title = document.createElement('h2');
  title.id = 'preview-title';
  title.textContent = words[0];
  const hint = document.createElement('p');
  const emptyLabels: Record<string, string> = {
    en: 'No supported control found. Continue manually in the browser, or try generic controls.',
    fr: 'Aucun contrôle pris en charge. Continuez manuellement dans le navigateur ou essayez les contrôles génériques.',
    es: 'No se encontró un control compatible. Continúe manualmente en el navegador o pruebe los controles genéricos.',
    de: 'Kein unterstütztes Element gefunden. Im Browser manuell fortfahren oder allgemeine Steuerelemente versuchen.',
    ar: 'لم يُعثر على عنصر تحكم مدعوم. تابع يدويًا في المتصفح أو جرّب عناصر التحكم العامة.',
    'zh-CN': '未找到支持的控件。请在浏览器中手动继续，或尝试通用控件。',
  };
  hint.textContent = preview.candidates.length ? words[1] : (emptyLabels[locale] ?? emptyLabels.en);
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  panel.append(title, hint, status);
  let selected: string | undefined;
  const groups = new Map<string, number>();
  const radios: HTMLInputElement[] = [];
  for (const c of preview.candidates) {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'download-control';
    radio.value = c.localId;
    radio.addEventListener('change', () => {
      selected = c.localId;
      submit.disabled = false;
    });
    const text = document.createElement('span');
    if (c.group && !groups.has(c.group)) groups.set(c.group, groups.size + 1);
    text.textContent =
      ' ' +
      c.text +
      ' — ' +
      words[6] +
      ': ' +
      (c.panelHost ?? c.destinationHost ?? '—') +
      ' · ' +
      words[7] +
      ': ' +
      (actionLabels[locale] ?? actionLabels.en)[c.action] +
      (c.group ? ' · ' + words[8] + ': ' + groups.get(c.group) : '');
    label.append(radio, text);
    panel.append(label);
    radios.push(radio);
  }
  const button = (text: string, fn: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', fn);
    panel.append(b);
    return b;
  };
  const close = () => {
    lifetime.abort();
    host.remove();
    previous?.focus();
  };
  const submit = button(words[2], () => {
    if (!selected) return;
    submit.disabled = true;
    radios.forEach((radio) => {
      radio.disabled = true;
    });
    void select(selected, lifetime.signal)
      .then(close)
      .catch(() => {
        if (!lifetime.signal.aborted) stale();
      });
  });
  submit.disabled = true;
  button(words[3], close);
  button(words[4], () => {
    stale();
    refresh();
  });
  if (disableAdapter && preview.binding.adapterId !== 'generic') {
    const labels: Record<string, string> = {
      en: 'Use generic controls',
      fr: 'Utiliser les contrôles génériques',
      es: 'Usar controles genéricos',
      de: 'Allgemeine Steuerelemente verwenden',
      ar: 'استخدام عناصر التحكم العامة',
      'zh-CN': '使用通用控件',
    };
    button(labels[locale] ?? labels.en, () => {
      void disableAdapter()
        .then(() => {
          stale();
          refresh();
        })
        .catch(() => {
          if (!lifetime.signal.aborted) stale();
        });
    });
  }
  const stale = () => {
    status.textContent = words[5];
    submit.disabled = true;
    radios.forEach((radio) => {
      radio.disabled = true;
    });
  };
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled)'),
      ];
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && root.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && root.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  root.append(panel);
  document.documentElement.append(host);
  const firstFocus = radios[0] ?? panel.querySelector<HTMLButtonElement>('button:not(:disabled)');
  firstFocus?.focus();
  return { close, stale, signal: lifetime.signal };
}
export const previewLocales = Object.keys(messages);
