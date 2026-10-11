import { useState } from 'react';
import type { Settings } from '../types';
const labels: Record<string, string[]> = {
  en: [
    'Optional image solver',
    'Enable 2Captcha',
    'Allow external image and instruction upload',
    'Key reference',
    'API key',
    'Save key to OS keyring',
    'Total ceiling (micro USD)',
    'Per-task reservation (micro USD)',
    'Images only; cookies, page HTML and CSRF tokens remain local. Zero budget blocks requests.',
  ],
  fr: [
    'Solveur visuel facultatif',
    'Activer 2Captcha',
    'Autoriser le transfert externe de l’image et de la consigne',
    'Référence de clé',
    'Clé API',
    'Enregistrer dans le trousseau système',
    'Plafond total (micro USD)',
    'Réservation par tâche (micro USD)',
    'Images uniquement ; cookies, HTML et jetons CSRF restent locaux. Un budget nul bloque les requêtes.',
  ],
  es: [
    'Solucionador opcional de imágenes',
    'Activar 2Captcha',
    'Permitir envío externo de imagen e instrucción',
    'Referencia de clave',
    'Clave API',
    'Guardar en el almacén del sistema',
    'Límite total (micro USD)',
    'Reserva por tarea (micro USD)',
    'Solo imágenes; cookies, HTML y CSRF permanecen locales. Presupuesto cero bloquea solicitudes.',
  ],
  de: [
    'Optionaler Bildlöser',
    '2Captcha aktivieren',
    'Externes Hochladen von Bild und Anweisung erlauben',
    'Schlüsselreferenz',
    'API-Schlüssel',
    'Im Betriebssystem speichern',
    'Gesamtlimit (Mikro USD)',
    'Reservierung pro Aufgabe (Mikro USD)',
    'Nur Bilder; Cookies, HTML und CSRF bleiben lokal. Nullbudget blockiert Anfragen.',
  ],
  ar: [
    'محلل صور اختياري',
    'تفعيل 2Captcha',
    'السماح برفع الصورة والتعليمات خارجياً',
    'مرجع المفتاح',
    'مفتاح API',
    'حفظ في مخزن مفاتيح النظام',
    'الحد الإجمالي (ميكرو دولار)',
    'الحجز لكل مهمة (ميكرو دولار)',
    'صور فقط؛ تبقى ملفات الارتباط وHTML ورموز CSRF محلياً. تمنع الميزانية الصفرية الطلبات.',
  ],
  'zh-CN': [
    '可选图片求解器',
    '启用 2Captcha',
    '允许向外部上传图片和说明',
    '密钥引用',
    'API 密钥',
    '保存到系统密钥环',
    '总限额（微美元）',
    '单任务预留（微美元）',
    '仅图片；Cookie、HTML 和 CSRF 保留在本地。零预算禁止请求。',
  ],
};
export function CaptchaSettings({
  value,
  locale,
  onChange,
  saveKey,
  loadBudget,
}: {
  value: Settings['captcha'];
  locale: string;
  onChange: (v: Settings['captcha']) => void;
  saveKey: (id: string, key: string) => Promise<unknown>;
  loadBudget: () => Promise<{ spent_microusd: number; reserved_microusd: number; pending: number }>;
}) {
  const text = labels[locale] ?? labels.en;
  const [key, setKey] = useState(''),
    [status, setStatus] = useState('');
  const budgetLabels: Record<string, string[]> = {
    en: ['Refresh budget', 'Spent', 'Reserved'],
    fr: ['Actualiser le budget', 'Dépensé', 'Réservé'],
    es: ['Actualizar presupuesto', 'Gastado', 'Reservado'],
    de: ['Budget aktualisieren', 'Ausgegeben', 'Reserviert'],
    ar: ['تحديث الميزانية', 'المصروف', 'المحجوز'],
    'zh-CN': ['刷新预算', '已花费', '预留'],
  };
  const budgetText = budgetLabels[locale] ?? budgetLabels.en;
  const patch = (p: Partial<typeof value>) => onChange({ ...value, ...p });
  return (
    <fieldset>
      <legend>{text[0]}</legend>
      <label>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        {text[1]}
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.external_opt_in}
          onChange={(e) => patch({ external_opt_in: e.target.checked })}
        />
        {text[2]}
      </label>
      <label>
        {text[3]}
        <input
          value={value.key_ref}
          maxLength={128}
          onChange={(e) => patch({ key_ref: e.target.value })}
        />
      </label>
      <label>
        {text[4]}
        <input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!value.key_ref || !key}
        onClick={() => {
          void saveKey(value.key_ref, key)
            .then(() => {
              setKey('');
              setStatus(text[5]);
            })
            .catch(() => setStatus(text[8]));
        }}
      >
        {text[5]}
      </button>
      <label>
        {text[6]}
        <input
          type="number"
          min={0}
          max={100000000}
          step={1}
          value={value.total_budget_microusd}
          onChange={(e) => patch({ total_budget_microusd: Number(e.target.value) })}
        />
      </label>
      <label>
        {text[7]}
        <input
          type="number"
          min={0}
          max={value.total_budget_microusd}
          step={1}
          value={value.task_ceiling_microusd}
          onChange={(e) => patch({ task_ceiling_microusd: Number(e.target.value) })}
        />
      </label>
      <p>{text[8]}</p>
      <button
        type="button"
        onClick={() => {
          void loadBudget().then((b) =>
            setStatus(
              budgetText[1] +
                ': ' +
                b.spent_microusd +
                '; ' +
                budgetText[2] +
                ': ' +
                b.reserved_microusd +
                ' micro USD',
            ),
          );
        }}
      >
        {budgetText[0]}
      </button>
      <p role="status">{status}</p>
    </fieldset>
  );
}
