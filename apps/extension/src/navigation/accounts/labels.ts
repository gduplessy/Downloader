const en = {
  mismatch: 'This account belongs to another site or browser session. Choose its matching job.',
  failure: 'Account operation failed. Check the selected session and saved credentials.',
  title: 'Browser accounts',
  job: 'Owned browser job',
  label: 'Account label',
  account: 'Account identity',
  origin: 'Exact site origin',
  password: 'Saved password',
  fill: 'Allow saved credential fill on qualified forms',
  existing: 'Existing browser session only',
  save: 'Save scoped account',
  remove: 'Remove account and credential',
  select: 'Select this account/session',
  mode: 'Download mode',
  free: 'Free',
  premium: 'Existing premium entitlement',
  manual: 'Manual',
  choose: 'Choose an owned browser job',
  scope: 'Browser claim required. Start navigation first.',
  pending: 'Live provider login and premium layouts await qualification.',
  fillNow: 'Fill and submit this sign-in form',
  cancel: 'Cancel',
  unknown: 'Entitlement unknown. Continue manually.',
  login: 'Sign in in this browser session.',
  mfa: 'Complete MFA in the browser.',
  credentials_rejected: 'Credentials rejected. Correct them in the desktop app.',
  expired: 'Entitlement expired. Select free/manual or another account.',
  quota: 'Account quota exhausted. Select free/manual or another account.',
  selected: 'Selected browser account',
  stale: 'Page or session changed. Continue from the current page.',
};
export type AccountLabel = keyof typeof en;
const rows: Record<AccountLabel, readonly string[]> = {
  mismatch: [
    'Ce compte appartient à un autre site ou une autre session. Choisir la tâche correspondante.',
    'Esta cuenta pertenece a otro sitio o sesión. Elija su tarea correspondiente.',
    'Dieses Konto gehört zu einer anderen Website oder Sitzung. Passenden Auftrag auswählen.',
    'هذا الحساب مرتبط بموقع أو جلسة أخرى. اختر المهمة المطابقة.',
    '此账户属于其他网站或浏览器会话。请选择对应任务。',
  ],
  failure: [
    'Opération échouée. Vérifier la session et les identifiants enregistrés.',
    'Operación fallida. Compruebe la sesión y las credenciales guardadas.',
    'Kontovorgang fehlgeschlagen. Sitzung und gespeicherte Zugangsdaten prüfen.',
    'فشلت عملية الحساب. تحقق من الجلسة وبيانات الدخول المحفوظة.',
    '账户操作失败。请检查已选择的会话和保存的凭据。',
  ],

  title: [
    'Comptes du navigateur',
    'Cuentas del navegador',
    'Browserkonten',
    'حسابات المتصفح',
    '浏览器账户',
  ],
  job: [
    'Tâche du navigateur attribuée',
    'Tarea del navegador asignada',
    'Zugeordneter Browserauftrag',
    'مهمة المتصفح المملوكة',
    '已绑定浏览器任务',
  ],
  label: ['Nom du compte', 'Nombre de cuenta', 'Kontobezeichnung', 'اسم الحساب', '账户名称'],
  account: [
    'Identité du compte',
    'Identidad de cuenta',
    'Kontoidentität',
    'هوية الحساب',
    '账户身份',
  ],
  origin: [
    'Origine exacte du site',
    'Origen exacto del sitio',
    'Exakter Website-Ursprung',
    'مصدر الموقع الدقيق',
    '精确网站来源',
  ],
  password: [
    'Mot de passe enregistré',
    'Contraseña guardada',
    'Gespeichertes Passwort',
    'كلمة المرور المحفوظة',
    '保存的密码',
  ],
  fill: [
    'Autoriser le remplissage des formulaires qualifiés',
    'Permitir rellenar formularios verificados',
    'Ausfüllen geprüfter Anmeldeformulare erlauben',
    'السماح بملء نماذج الدخول المؤهلة',
    '允许填写已验证登录表单',
  ],
  existing: [
    'Session existante uniquement',
    'Solo sesión existente',
    'Nur bestehende Browsersitzung',
    'جلسة المتصفح الحالية فقط',
    '仅使用现有浏览器会话',
  ],
  save: [
    'Enregistrer le compte lié',
    'Guardar cuenta vinculada',
    'Sitzungsgebundenes Konto speichern',
    'حفظ الحساب المرتبط بالجلسة',
    '保存已绑定账户',
  ],
  remove: [
    'Supprimer le compte et ses identifiants',
    'Eliminar cuenta y credenciales',
    'Konto und Zugangsdaten entfernen',
    'حذف الحساب وبيانات الدخول',
    '删除账户及凭据',
  ],
  select: [
    'Choisir ce compte et cette session',
    'Seleccionar esta cuenta y sesión',
    'Dieses Konto und diese Sitzung auswählen',
    'اختيار هذا الحساب والجلسة',
    '选择此账户和会话',
  ],
  mode: ['Mode de téléchargement', 'Modo de descarga', 'Downloadmodus', 'وضع التنزيل', '下载模式'],
  free: ['Gratuit', 'Gratuito', 'Kostenlos', 'مجاني', '免费'],
  premium: [
    'Abonnement premium existant',
    'Suscripción premium existente',
    'Vorhandene Premiumberechtigung',
    'صلاحية مميزة حالية',
    '现有高级权限',
  ],
  manual: ['Manuel', 'Manual', 'Manuell', 'يدوي', '手动'],
  choose: [
    'Choisir une tâche du navigateur',
    'Elegir una tarea del navegador',
    'Browserauftrag auswählen',
    'اختيار مهمة متصفح',
    '选择浏览器任务',
  ],
  scope: [
    'Démarrer la navigation pour attribuer une session.',
    'Inicie navegación para vincular la sesión.',
    'Navigation starten, um die Sitzung zuzuordnen.',
    'ابدأ التنقل لربط جلسة المتصفح.',
    '请先开始导航以绑定浏览器会话。',
  ],
  pending: [
    'Qualification des sites réels en attente.',
    'Pendiente validar sitios reales.',
    'Prüfung realer Anbieter steht aus.',
    'تأهيل المواقع الحقيقية قيد الانتظار.',
    '真实网站验证待完成。',
  ],
  fillNow: [
    'Remplir et envoyer cette connexion',
    'Rellenar y enviar este acceso',
    'Diese Anmeldung ausfüllen und absenden',
    'ملء نموذج الدخول هذا وإرساله',
    '填写并提交此登录表单',
  ],
  cancel: ['Annuler', 'Cancelar', 'Abbrechen', 'إلغاء', '取消'],
  unknown: [
    'Abonnement inconnu. Continuer manuellement.',
    'Suscripción desconocida. Continuar manualmente.',
    'Berechtigung unbekannt. Manuell fortfahren.',
    'الصلاحية غير معروفة. تابع يدويًا.',
    '权限未知。请手动继续。',
  ],
  login: [
    'Se connecter dans cette session.',
    'Acceda en esta sesión.',
    'In dieser Sitzung anmelden.',
    'سجل الدخول في هذه الجلسة.',
    '请在此会话中登录。',
  ],
  mfa: [
    'Terminer la MFA dans le navigateur.',
    'Complete MFA en el navegador.',
    'MFA im Browser abschließen.',
    'أكمل التحقق متعدد العوامل في المتصفح.',
    '请在浏览器中完成多因素验证。',
  ],
  credentials_rejected: [
    'Identifiants refusés. Corriger dans le bureau.',
    'Credenciales rechazadas. Corrija en el escritorio.',
    'Zugangsdaten abgelehnt. In der Desktop-App korrigieren.',
    'بيانات الدخول مرفوضة. صححها في تطبيق سطح المكتب.',
    '凭据被拒绝。请在桌面应用中更正。',
  ],
  expired: [
    'Abonnement expiré. Choisir gratuit, manuel ou un autre compte.',
    'Suscripción vencida. Elija gratis, manual u otra cuenta.',
    'Berechtigung abgelaufen. Kostenlos, manuell oder anderes Konto wählen.',
    'انتهت الصلاحية. اختر الوضع المجاني أو اليدوي أو حسابًا آخر.',
    '权限已过期。请选择免费、手动或其他账户。',
  ],
  quota: [
    'Quota épuisé. Choisir gratuit, manuel ou un autre compte.',
    'Cuota agotada. Elija gratis, manual u otra cuenta.',
    'Kontokontingent erschöpft. Kostenlos, manuell oder anderes Konto wählen.',
    'نفدت حصة الحساب. اختر الوضع المجاني أو اليدوي أو حسابًا آخر.',
    '账户配额耗尽。请选择免费、手动或其他账户。',
  ],
  selected: [
    'Compte navigateur sélectionné',
    'Cuenta del navegador seleccionada',
    'Ausgewähltes Browserkonto',
    'حساب المتصفح المحدد',
    '已选择浏览器账户',
  ],
  stale: [
    'Page ou session modifiée. Reprendre depuis la page actuelle.',
    'Página o sesión cambiada. Continúe desde la página actual.',
    'Seite oder Sitzung geändert. Auf aktueller Seite fortfahren.',
    'تغيرت الصفحة أو الجلسة. تابع من الصفحة الحالية.',
    '页面或会话已更改。请从当前页面继续。',
  ],
};
export function accountLabel(locale: string, key: AccountLabel): string {
  const index = ['fr', 'es', 'de', 'ar', 'zh-CN'].indexOf(locale);
  return index < 0 ? en[key] : rows[key][index];
}
export const accountLabelKeys = Object.keys(en) as AccountLabel[];

export function accountError(locale: string, error: unknown): string {
  const value = String(error);
  const key: AccountLabel = /session_mismatch|origin_mismatch|identity_is_immutable/.test(value)
    ? 'mismatch'
    : /credentials_missing|password_invalid|credentials_removed/.test(value)
      ? 'credentials_rejected'
      : /provider_unsupported|form_unqualified/.test(value)
        ? 'pending'
        : /scope_required|job_unavailable/.test(value)
          ? 'scope'
          : /private_accounts|saved_fill_disabled/.test(value)
            ? 'existing'
            : /stale|expired_or_consumed|binding/.test(value)
              ? 'stale'
              : 'failure';
  return accountLabel(locale, key);
}
