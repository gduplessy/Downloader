export const captureKeys = [
  'heading',
  'blob',
  'response',
  'firefoxResponse',
  'destination',
  'policy',
  'choose',
  'queued',
  'offline',
  'refresh',
  'ready',
  'disabled',
  'api_unavailable',
  'permission_required',
  'scope_unavailable',
  'firefoxPending',
  'setupHelp',
  'desktopHelp',
  'scopeHelp',
] as const;
export type CaptureTextKey = (typeof captureKeys)[number];
export const captureLocales: Record<string, Record<CaptureTextKey, string>> = {
  en: {
    heading: 'Direct browser streaming',
    blob: 'Page-generated file (Blob)',
    response: 'Original download response',
    firefoxResponse: 'Page-owned response (XHR)',
    destination: 'Desktop download folder',
    policy:
      'New jobs use the desktop default folder and category rules. Existing jobs keep their assigned folders.',
    choose: 'Choose in desktop',
    queued: 'Request queued. Keep Downloader open to show its download-folder settings.',
    offline: 'Open Downloader to read or change the download folder.',
    refresh: 'Refresh capture status',
    ready:
      'Required APIs and permissions are available. The selected site and session are checked again before capture.',
    disabled: 'Off in this browser profile. Enable direct streaming and save to opt in.',
    api_unavailable: 'The required browser API is unavailable. Use browser download for this lane.',
    permission_required:
      'Required site or capture permission is missing. Grant access in extension settings.',
    scope_unavailable:
      'An explicit browser session scope is unavailable. Capture is blocked in this context.',
    firefoxPending:
      'Firefox binary file navigation remains unavailable; use a supported page-owned action or browser download.',
    setupHelp:
      'Direct capture and destination setup are in extension settings. Browser-saved files remain separate from verified desktop downloads.',
    desktopHelp:
      'Enable direct capture separately in each browser profile through the extension settings. API and permission status is shown there.',
    scopeHelp:
      'Enter a site in Site scope to inspect its permissions; otherwise this checks all-site access.',
  },
  fr: {
    heading: 'Transfert direct du navigateur',
    blob: 'Fichier généré dans la page (Blob)',
    response: 'Réponse de téléchargement originale',
    firefoxResponse: 'Réponse de la page (XHR)',
    destination: 'Dossier de téléchargement du bureau',
    policy:
      'Les nouvelles tâches utilisent le dossier et les catégories du bureau. Les tâches existantes gardent leur dossier.',
    choose: 'Choisir sur le bureau',
    queued: 'Demande en attente. Gardez Downloader ouvert pour afficher les paramètres du dossier.',
    offline: 'Ouvrez Downloader pour consulter ou modifier le dossier.',
    refresh: 'Actualiser la disponibilité',
    ready:
      'Les API et permissions sont disponibles. Le site et la session seront revérifiés avant la capture.',
    disabled: 'Désactivé dans ce profil. Activez le transfert direct et enregistrez.',
    api_unavailable: 'L’API requise est indisponible. Utilisez le téléchargement du navigateur.',
    permission_required:
      'Permission de site ou de capture manquante. Accordez l’accès dans les paramètres.',
    scope_unavailable:
      'La session explicite est indisponible. La capture est bloquée dans ce contexte.',
    firefoxPending:
      'La navigation vers un fichier binaire reste indisponible dans Firefox ; utilisez une action de page compatible ou le navigateur.',
    setupHelp:
      'La capture et le dossier se configurent dans l’extension. Les fichiers du navigateur restent distincts des transferts vérifiés.',
    desktopHelp:
      'Activez la capture dans chaque profil via les paramètres de l’extension. Les API et permissions y sont indiquées.',
    scopeHelp:
      'Saisissez un site dans la portée pour vérifier ses permissions ; sinon l’accès à tous les sites est vérifié.',
  },
  es: {
    heading: 'Transmisión directa del navegador',
    blob: 'Archivo generado en la página (Blob)',
    response: 'Respuesta original de descarga',
    firefoxResponse: 'Respuesta de la página (XHR)',
    destination: 'Carpeta de descarga del escritorio',
    policy:
      'Las tareas nuevas usan la carpeta y las categorías del escritorio. Las existentes conservan su carpeta.',
    choose: 'Elegir en el escritorio',
    queued:
      'Solicitud en cola. Mantén Downloader abierto para mostrar la configuración de carpeta.',
    offline: 'Abre Downloader para consultar o cambiar la carpeta.',
    refresh: 'Actualizar disponibilidad',
    ready:
      'Las API y los permisos están disponibles. Se volverán a comprobar el sitio y la sesión antes de capturar.',
    disabled: 'Desactivado en este perfil. Activa la transmisión directa y guarda.',
    api_unavailable: 'La API necesaria no está disponible. Usa la descarga del navegador.',
    permission_required:
      'Falta permiso del sitio o de captura. Concede acceso en la configuración.',
    scope_unavailable:
      'La sesión explícita no está disponible. La captura está bloqueada en este contexto.',
    firefoxPending:
      'La navegación a archivos binarios sigue sin estar disponible en Firefox; usa una acción de página compatible o el navegador.',
    setupHelp:
      'La captura y la carpeta se configuran en la extensión. Los archivos del navegador siguen separados de las descargas verificadas.',
    desktopHelp:
      'Activa la captura en cada perfil desde la extensión. Allí se muestran las API y los permisos.',
    scopeHelp:
      'Introduce un sitio en el ámbito para comprobar sus permisos; de lo contrario se comprueba el acceso a todos.',
  },
  de: {
    heading: 'Direkte Browserübertragung',
    blob: 'In der Seite erzeugte Datei (Blob)',
    response: 'Ursprüngliche Downloadantwort',
    firefoxResponse: 'Antwort der Seite (XHR)',
    destination: 'Downloadordner der Desktop-App',
    policy:
      'Neue Aufträge nutzen den Desktopordner und die Kategorien. Bestehende Aufträge behalten ihren Ordner.',
    choose: 'In Desktop-App wählen',
    queued:
      'Anfrage vorgemerkt. Downloader muss geöffnet sein, um die Ordnereinstellungen anzuzeigen.',
    offline: 'Downloader öffnen, um den Ordner anzuzeigen oder zu ändern.',
    refresh: 'Verfügbarkeit aktualisieren',
    ready:
      'APIs und Berechtigungen sind verfügbar. Website und Sitzung werden vor der Erfassung erneut geprüft.',
    disabled: 'In diesem Profil deaktiviert. Direkte Übertragung aktivieren und speichern.',
    api_unavailable:
      'Die benötigte Browser-API fehlt. Für diesen Weg den Browserdownload verwenden.',
    permission_required:
      'Website- oder Erfassungsberechtigung fehlt. Zugriff in den Erweiterungseinstellungen erteilen.',
    scope_unavailable:
      'Eine eindeutige Browsersitzung fehlt. Erfassung ist in diesem Kontext gesperrt.',
    firefoxPending:
      'Binäre Dateinavigation bleibt in Firefox nicht verfügbar; eine unterstützte Seitenaktion oder den Browserdownload verwenden.',
    setupHelp:
      'Erfassung und Zielordner werden in der Erweiterung eingerichtet. Browserdateien bleiben von geprüften Desktopdownloads getrennt.',
    desktopHelp:
      'Direkte Erfassung je Browserprofil in den Erweiterungseinstellungen aktivieren. Dort stehen API- und Berechtigungsstatus.',
    scopeHelp:
      'Website im Geltungsbereich eingeben, um deren Berechtigungen zu prüfen; sonst wird der Zugriff auf alle Websites geprüft.',
  },
  'zh-CN': {
    heading: '浏览器直接传输',
    blob: '页面生成的文件（Blob）',
    response: '原始下载响应',
    firefoxResponse: '页面响应（XHR）',
    destination: '桌面下载文件夹',
    policy: '新任务使用桌面默认文件夹和分类规则。现有任务保留原文件夹。',
    choose: '在桌面中选择',
    queued: '请求已排队。请保持 Downloader 打开以显示下载文件夹设置。',
    offline: '打开 Downloader 以查看或更改文件夹。',
    refresh: '刷新可用状态',
    ready: '所需 API 和权限可用。捕获前将再次检查所选网站和会话。',
    disabled: '此浏览器配置文件中已关闭。启用直接传输并保存以加入。',
    api_unavailable: '所需浏览器 API 不可用。请使用浏览器下载。',
    permission_required: '缺少网站或捕获权限。请在扩展设置中授权。',
    scope_unavailable: '无法建立明确的浏览器会话。此环境中禁止捕获。',
    firefoxPending: 'Firefox 暂不支持二进制文件导航捕获；请使用受支持的页面操作或浏览器下载。',
    setupHelp: '直接捕获和目标文件夹在扩展设置中配置。浏览器保存的文件与已验证桌面下载分别显示。',
    desktopHelp: '请在各浏览器配置文件的扩展设置中分别启用捕获；其中显示 API 和权限状态。',
    scopeHelp: '在网站范围中输入网站以检查其权限；否则检查所有网站访问权限。',
  },
  ar: {
    heading: 'البث المباشر من المتصفح',
    blob: 'ملف منشأ في الصفحة (Blob)',
    response: 'استجابة التنزيل الأصلية',
    firefoxResponse: 'استجابة الصفحة (XHR)',
    destination: 'مجلد تنزيل سطح المكتب',
    policy: 'تستخدم المهام الجديدة مجلد سطح المكتب وقواعد الفئات. تحتفظ المهام الحالية بمجلداتها.',
    choose: 'اختيار في سطح المكتب',
    queued: 'أُدرج الطلب في الانتظار. أبقِ Downloader مفتوحًا لعرض إعدادات المجلد.',
    offline: 'افتح Downloader لعرض المجلد أو تغييره.',
    refresh: 'تحديث حالة الالتقاط',
    ready: 'واجهات البرمجة والأذونات متاحة. سيُفحص الموقع والجلسة مجددًا قبل الالتقاط.',
    disabled: 'معطل في ملف المتصفح هذا. فعّل البث المباشر واحفظ للاشتراك.',
    api_unavailable: 'واجهة المتصفح المطلوبة غير متاحة. استخدم تنزيل المتصفح لهذا المسار.',
    permission_required: 'إذن الموقع أو الالتقاط مفقود. امنح الوصول في إعدادات الإضافة.',
    scope_unavailable: 'جلسة متصفح صريحة غير متاحة. الالتقاط محظور في هذا السياق.',
    firefoxPending:
      'التنقل إلى ملف ثنائي غير متاح في Firefox؛ استخدم إجراء صفحة مدعومًا أو تنزيل المتصفح.',
    setupHelp:
      'يُضبط الالتقاط والوجهة في إعدادات الإضافة. تبقى ملفات المتصفح منفصلة عن تنزيلات سطح المكتب المتحقق منها.',
    desktopHelp:
      'فعّل الالتقاط لكل ملف متصفح من إعدادات الإضافة. تُعرض حالة الواجهات والأذونات هناك.',
    scopeHelp: 'أدخل موقعًا في نطاق المواقع لفحص أذوناته؛ وإلا يُفحص الوصول إلى كل المواقع.',
  },
};
export function captureText(locale: string, key: CaptureTextKey): string {
  return (captureLocales[locale] ?? captureLocales.en)[key];
}
