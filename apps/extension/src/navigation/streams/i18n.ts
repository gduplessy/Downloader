export const streamText = {
  en: {
    enable: 'Enable direct browser streaming',
    permission:
      'Chromium requests debugger permission at installation. Capture stays off until enabled and attaches only to an owned navigation action.',
    takeover:
      'Capturing an original response is irreversible. Interrupted one-use requests require a fresh provider action.',
    armed: 'Direct capture armed',
    taking_original_response: 'Taking original response',
    streaming: 'Streaming to desktop',
    complete: 'Verified desktop download complete',
    interrupted: 'Capture interrupted; request a fresh action',
    detached: 'Debugger detached; request a fresh action',
    cancel: 'Cancel direct capture',
  },
  es: {
    enable: 'Activar transmisión directa del navegador',
    permission:
      'Chromium solicita permiso de depuración al instalar. La captura permanece desactivada hasta habilitarla y solo se conecta a una navegación asignada.',
    takeover:
      'Capturar una respuesta original es irreversible. Las solicitudes de un solo uso interrumpidas requieren una nueva acción del proveedor.',
    armed: 'Captura directa preparada',
    taking_original_response: 'Capturando respuesta original',
    streaming: 'Transmitiendo al escritorio',
    complete: 'Descarga verificada completada',
    interrupted: 'Captura interrumpida; solicita una nueva acción',
    detached: 'Depurador desconectado; solicita una nueva acción',
    cancel: 'Cancelar captura directa',
  },
  fr: {
    enable: 'Activer le transfert direct du navigateur',
    permission:
      'Chromium demande la permission de débogage à l’installation. La capture reste désactivée jusqu’à son activation et ne concerne qu’une navigation attribuée.',
    takeover:
      'La capture de la réponse originale est irréversible. Une requête à usage unique interrompue nécessite une nouvelle action du fournisseur.',
    armed: 'Capture directe prête',
    taking_original_response: 'Capture de la réponse originale',
    streaming: 'Transfert vers le bureau',
    complete: 'Téléchargement vérifié terminé',
    interrupted: 'Capture interrompue ; demander une nouvelle action',
    detached: 'Débogueur déconnecté ; demander une nouvelle action',
    cancel: 'Annuler la capture directe',
  },
  de: {
    enable: 'Direkte Browserübertragung aktivieren',
    permission:
      'Chromium fordert bei der Installation die Debugger-Berechtigung an. Die Erfassung bleibt bis zur Aktivierung ausgeschaltet und betrifft nur eine zugewiesene Navigation.',
    takeover:
      'Die Erfassung der Originalantwort ist unumkehrbar. Unterbrochene Einmalanfragen benötigen eine neue Aktion beim Anbieter.',
    armed: 'Direkte Erfassung bereit',
    taking_original_response: 'Originalantwort wird erfasst',
    streaming: 'Übertragung zum Desktop',
    complete: 'Geprüfter Download abgeschlossen',
    interrupted: 'Erfassung unterbrochen; neue Aktion erforderlich',
    detached: 'Debugger getrennt; neue Aktion erforderlich',
    cancel: 'Direkte Erfassung abbrechen',
  },
  'zh-CN': {
    enable: '启用浏览器直接传输',
    permission: 'Chromium 在安装时请求调试器权限。捕获默认关闭，仅在启用后连接到已分配的导航操作。',
    takeover: '捕获原始响应不可撤销。一次性请求中断后，需要在提供方执行新操作。',
    armed: '直接捕获已准备',
    taking_original_response: '正在接管原始响应',
    streaming: '正在传输到桌面',
    complete: '桌面下载已验证并完成',
    interrupted: '捕获中断；请执行新操作',
    detached: '调试器已断开；请执行新操作',
    cancel: '取消直接捕获',
  },
  ar: {
    enable: 'تفعيل البث المباشر من المتصفح',
    permission:
      'يطلب Chromium إذن التصحيح عند التثبيت. يبقى الالتقاط معطلاً حتى تفعيله ولا يتصل إلا بإجراء تنقل مخصص.',
    takeover:
      'التقاط الاستجابة الأصلية إجراء لا يمكن التراجع عنه. تتطلب الطلبات ذات الاستخدام الواحد المنقطعة إجراءً جديدًا لدى المزود.',
    armed: 'الالتقاط المباشر جاهز',
    taking_original_response: 'جارٍ التقاط الاستجابة الأصلية',
    streaming: 'جارٍ البث إلى سطح المكتب',
    complete: 'اكتمل التنزيل بعد التحقق',
    interrupted: 'انقطع الالتقاط؛ اطلب إجراءً جديدًا',
    detached: 'انقطع المصحح؛ اطلب إجراءً جديدًا',
    cancel: 'إلغاء الالتقاط المباشر',
  },
};
export type StreamTextKey = keyof typeof streamText.en;
export function streamTranslate(locale: string, key: StreamTextKey): string {
  return (streamText[locale as keyof typeof streamText] ?? streamText.en)[key];
}
