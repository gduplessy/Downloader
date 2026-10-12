import { RenderedResources } from './features/discovery/RenderedResources';
import { applyEvents, type EventBatch } from '../../../packages/shared/src/events';
import { useEffect, useMemo, useState, useRef, useId, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Plus,
  Search,
  Pause,
  Play,
  Check,
  AlertCircle,
  Settings as SettingsIcon,
  ListOrdered,
  Film,
  Globe,
  Plug,
  FolderOpen,
  FileDown,
  RefreshCw,
  X,
  ChevronDown,
  Download,
  PanelLeftClose,
} from 'lucide-react';
import { api, pickDirectory, fileAction } from './api';
import type { Job, Snapshot, Settings, Queue } from './types';
import { CaptchaSettings } from './features/CaptchaSettings';
import { translate, languages, type Key, type Locale } from '../../../packages/shared/src/i18n';
import { bytes, expandUrls } from '../../../packages/shared/src/utils';
const activeStates = [
  'solving_challenge',
  'connecting',
  'downloading',
  'verifying',
  'assembling',
  'scanning',
];
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} aria-labelledby={id} onCancel={onClose}>
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button className="icon" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [page, setPage] = useState('all'),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState<string | null>(null),
    [add, setAdd] = useState(false),
    [busy, setBusy] = useState(false),
    [sort, setSort] = useState('created'),
    [ascending, setAscending] = useState(false),
    [sidebar, setSidebar] = useState(true);
  const locale = (snapshot?.settings.locale ?? localStorage.getItem('locale') ?? 'en') as Locale;
  const t = (k: Key) => translate(locale, k);
  const engineSnapshot = useRef<Snapshot | null>(null);
  const loadingEvents = useRef(false);
  async function load() {
    if (loadingEvents.current) return;
    loadingEvents.current = true;
    try {
      if (!engineSnapshot.current) await api('negotiate', { minimum: 1, maximum: 1 });
      let batch = await api<EventBatch<Snapshot>>('subscribe', {
        after_sequence: engineSnapshot.current?.sequence ?? null,
        limit: 100,
      });
      let next = applyEvents(engineSnapshot.current, batch);
      if (!next) {
        batch = await api<EventBatch<Snapshot>>('subscribe', { after_sequence: null, limit: 100 });
        next = batch.snapshot;
      }
      engineSnapshot.current = next;
      setSnapshot(next);
      setError('');
    } catch (e) {
      engineSnapshot.current = null;
      setError(String(e));
    } finally {
      loadingEvents.current = false;
    }
  }
  async function run(command: string, args?: unknown) {
    setBusy(true);
    try {
      const value = await api(command, args);
      await load();
      return value;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    const timer = setInterval(load, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('locale', locale);
    const theme = snapshot?.settings.theme ?? 'system';
    document.documentElement.dataset.theme = theme;
  }, [locale, snapshot?.settings.theme]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setAdd(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.getElementById('search')?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => {
    if (!snapshot?.settings.clipboard) return;
    let last = '';
    const timer = setInterval(async () => {
      try {
        const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
        const text = (await readText()).trim();
        if (text !== last) {
          last = text;
          if (/^https?:\/\/[^\s]+\.(zip|pdf|exe|msi|mp4|mp3|7z)(\?.*)?$/i.test(text)) {
            setAdd(true);
            sessionStorage.setItem('clipboardURL', text);
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(timer);
  }, [snapshot?.settings.clipboard]);
  const jobs = useMemo(() => {
    let list = (snapshot?.jobs ?? []).filter(
      (j) =>
        page === 'all' ||
        (page === 'active' && activeStates.includes(j.state)) ||
        (page === 'completed' && ['complete', 'browser_complete'].includes(j.state)) ||
        (page === 'paused' && j.state === 'paused') ||
        (page === 'failed' &&
          [
            'failed',
            'waiting_authentication',
            'waiting_source',
            'waiting_user',
            'waiting_browser',
          ].includes(j.state)) ||
        page === 'q:' + j.queue ||
        page === 'c:' + j.category,
    );
    list = list.filter((j) =>
      (j.filename + ' ' + j.description).toLowerCase().includes(search.toLowerCase()),
    );
    return list.sort((a, b) => {
      const v =
        sort === 'size'
          ? (a.total ?? 0) - (b.total ?? 0)
          : sort === 'name'
            ? a.filename.localeCompare(b.filename)
            : a.created.localeCompare(b.created);
      return ascending ? v : -v;
    });
  }, [snapshot, page, search, sort, ascending]);
  const job = snapshot?.jobs.find((j) => j.id === selected);
  const currentTitle = page.startsWith('q:')
    ? snapshot?.queues.find((q) => 'q:' + q.id === page)?.name
    : page.startsWith('c:')
      ? snapshot?.settings.categories.find((c) => 'c:' + c.id === page)?.name
      : t(page as Key);
  const catching = (p: Promise<unknown>) => void p.catch(() => {});
  const nav = (id: string, icon: ReactNode, label: string, count?: number) => (
    <button
      className={'nav-item ' + (page === id ? 'selected' : '')}
      onClick={() => {
        setPage(id);
        setSelected(null);
      }}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
  return (
    <div
      className={'app ' + (!sidebar ? 'compact' : '')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const text =
          e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
        if (/^https?:\/\//.test(text)) {
          sessionStorage.setItem('clipboardURL', text);
          setAdd(true);
        }
      }}
    >
      <aside>
        <div className="brand">
          <span className="brand-mark">
            <ArrowDownToLine size={21} />
          </span>
          <strong>Downloader</strong>
          <small>0.1</small>
        </div>
        <div className="nav-section">
          {nav('all', <Download size={18} />, t('all'), snapshot?.jobs.length ?? 0)}
          {nav(
            'active',
            <Play size={18} />,
            t('active'),
            snapshot?.jobs.filter((j) => activeStates.includes(j.state)).length ?? 0,
          )}
          {nav('completed', <Check size={18} />, t('completed'))}
          {nav('paused', <Pause size={18} />, t('paused'))}
          {nav('failed', <AlertCircle size={18} />, t('failed'))}
        </div>
        <div className="nav-label">{t('queues')}</div>
        {snapshot?.queues.map((q) => nav('q:' + q.id, <ListOrdered size={17} />, q.name))}
        <div className="nav-label">{t('categories')}</div>
        {snapshot?.settings.categories.map((c) =>
          nav('c:' + c.id, <FolderOpen size={16} />, c.name),
        )}
        <div className="nav-section bottom">
          {nav('queues', <ListOrdered size={18} />, t('queues'))}
          {nav('media', <Film size={18} />, t('media'))}
          {nav('grabber', <Globe size={18} />, t('grabber'))}
          {nav('integration', <Plug size={18} />, t('integration'))}
          {nav('settings', <SettingsIcon size={18} />, t('settings'))}
        </div>
        <div className="local-label">
          <i />
          {t('readonly')}
        </div>
      </aside>
      <main>
        <header>
          <div className="header-title">
            <button
              className="icon"
              aria-label={t('categories')}
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeftClose size={20} />
            </button>
            <div>
              <h1>{currentTitle}</h1>
              <p>{t('title')}</p>
            </div>
          </div>
          <button className="primary" onClick={() => setAdd(true)}>
            <Plus size={18} />
            {t('add')}
          </button>
        </header>
        {error && (
          <div role="alert" className="error-banner">
            <AlertCircle size={17} />
            <span>{error}</span>
            <button onClick={() => catching(load())}>{t('retry')}</button>
            <button className="icon" onClick={() => setError('')} aria-label={t('close')}>
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'settings' && snapshot ? (
          <SettingsPage settings={snapshot.settings} t={t} run={run} />
        ) : page === 'queues' && snapshot ? (
          <QueuesPage queues={snapshot.queues} t={t} run={run} />
        ) : page === 'media' ? (
          <MediaPage t={t} run={run} />
        ) : page === 'grabber' ? (
          <GrabberPage t={t} run={run} directory={snapshot?.settings.directory ?? ''} />
        ) : page === 'integration' ? (
          <IntegrationPage snapshot={snapshot} t={t} run={run} />
        ) : (
          <>
            <div className="toolbar">
              <label className="search">
                <Search size={17} />
                <input
                  id="search"
                  placeholder={t('search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <div className="toolbar-actions">
                <button
                  disabled={!job || busy || !activeStates.includes(job.state)}
                  onClick={() => catching(run('pause', { id: job!.id }))}
                >
                  <Pause size={16} />
                  {t('pause')}
                </button>
                <button
                  disabled={
                    !job ||
                    busy ||
                    ![
                      'paused',
                      'failed',
                      'cancelled',
                      'waiting_source',
                      'waiting_authentication',
                    ].includes(job.state)
                  }
                  onClick={() => catching(run('resume', { id: job!.id, restart: false }))}
                >
                  <Play size={16} />
                  {t('resume')}
                </button>
                <button className="icon" aria-label={t('refresh')} onClick={() => catching(load())}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            <div className="list-container">
              <table>
                <thead>
                  <tr>
                    {[
                      ['name', 'name'],
                      ['status', 'status'],
                      ['size', 'size'],
                      ['progress', 'progress'],
                      ['speed', 'speed'],
                    ].map(([key, label]) => (
                      <th key={key}>
                        <button
                          onClick={() => {
                            setSort(key);
                            setAscending(sort === key ? !ascending : false);
                          }}
                        >
                          {t(label as Key)}
                          <ChevronDown size={12} />
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr
                      key={j.id}
                      tabIndex={0}
                      aria-selected={selected === j.id}
                      className={selected === j.id ? 'row-selected' : ''}
                      onClick={() => setSelected(j.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') setSelected(j.id);
                      }}
                    >
                      <td>
                        <div className="file-cell">
                          <span className="file-icon">
                            <FileDown size={20} />
                          </span>
                          <div>
                            <strong>{j.filename}</strong>
                            <small>{safeHost(j.url)}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={'status ' + j.state}>
                          <i />
                          {t(j.state as Key)}
                        </span>
                      </td>
                      <td>{bytes(j.total)}</td>
                      <td>
                        <div className="progress-line">
                          <progress max={j.total ?? 1} value={j.bytes} />
                          <span>
                            {j.total
                              ? Math.min(100, (j.bytes / j.total) * 100).toFixed(0) + '%'
                              : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="mono">{j.speed ? bytes(j.speed) + '/s' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {jobs.length === 0 && (
                <div className="empty">
                  <div className="empty-icon">
                    <ArrowDownToLine size={34} />
                  </div>
                  <h2>{t('empty')}</h2>
                  <p>{t('emptyHint')}</p>
                  <button onClick={() => setAdd(true)}>
                    <Plus size={16} />
                    {t('add')}
                  </button>
                </div>
              )}
            </div>
            {job && (
              <section className="details">
                <div className="section-head">
                  <h2>{t('details')}</h2>
                  <button
                    className="icon"
                    onClick={() => setSelected(null)}
                    aria-label={t('close')}
                  >
                    <X size={17} />
                  </button>
                </div>
                <strong>{job.filename}</strong>
                <div className="detail-grid">
                  <span>{t('destination')}</span>
                  <code>{job.destination}</code>
                  <span>{t('progress')}</span>
                  <span>
                    {bytes(job.bytes)} / {bytes(job.total)}
                  </span>
                  <span>{t('connections')}</span>
                  <span>{job.segments.length}</span>
                  <span>{t('elapsed')}</span>
                  <span>{new Date(job.created).toLocaleString(locale)}</span>
                </div>
                {job.segments.length > 0 && (
                  <div className="segments">
                    {job.segments.map((s, i) => (
                      <progress
                        key={i}
                        aria-label={t('connections') + ' ' + (i + 1)}
                        max={s.end - s.start + 1}
                        value={s.downloaded}
                      />
                    ))}
                  </div>
                )}
                {job.error && (
                  <div role="alert" className="inline-error">
                    {job.error}
                    {job.failure && <p>{job.failure.recovery.join(', ').replaceAll('_', ' ')}</p>}
                  </div>
                )}
                {job.solver_outcome && <p role="status">{t(job.solver_outcome as Key)}</p>}
                <div className="actions">
                  {job.page_url && (
                    <button
                      disabled={
                        busy ||
                        !snapshot?.settings.solver.enabled ||
                        snapshot.settings.network.proxy_mode !== 'direct' ||
                        !['waiting_browser', 'waiting_user'].includes(job.state)
                      }
                      onClick={() =>
                        catching(
                          run('solve_challenge', {
                            id: job.id,
                            automatic: false,
                            url: job.navigation_url ?? job.page_url,
                          }),
                        )
                      }
                    >
                      {t('trySolver')}
                    </button>
                  )}
                  <button
                    disabled={job.state !== 'complete'}
                    onClick={() => catching(fileAction(job.id))}
                  >
                    {t('open')}
                  </button>
                  <button onClick={() => catching(fileAction(job.id, true))}>{t('reveal')}</button>
                  <button
                    disabled={activeStates.includes(job.state)}
                    onClick={() => {
                      const url = window.prompt(t('url'), job.url);
                      if (url)
                        catching(
                          run('refresh', {
                            id: job.id,
                            url,
                            context: {
                              headers: {},
                              credential_id:
                                job.state === 'waiting_authentication'
                                  ? window.prompt(t('credential'), job.credential_id ?? '')
                                  : (job.credential_id ?? null),
                            },
                          }),
                        );
                    }}
                  >
                    {t('refresh')}
                  </button>
                  <button
                    disabled={activeStates.includes(job.state) || job.state === 'complete'}
                    onClick={() => {
                      if (window.confirm(t('warningRestart')))
                        catching(run('resume', { id: job.id, restart: true }));
                    }}
                  >
                    {t('restart')}
                  </button>
                  <button
                    disabled={activeStates.includes(job.state)}
                    onClick={() => {
                      if (window.confirm(t('remove') + '?'))
                        catching(run('remove', { id: job.id, delete_file: false }));
                    }}
                  >
                    {t('remove')}
                  </button>
                </div>
              </section>
            )}
            <footer>
              <span>
                {jobs.length} {t('downloads')}
              </span>
              <span>
                <i className={snapshot ? 'online-dot' : 'offline-dot'} />
                {snapshot ? t('connected') : t('offline')}
              </span>
            </footer>
          </>
        )}
      </main>
      {add && (
        <AddModal
          t={t}
          settings={snapshot?.settings}
          queues={snapshot?.queues ?? []}
          onClose={() => setAdd(false)}
          run={run}
        />
      )}
    </div>
  );
}
function safeHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
type T = (k: Key) => string;
type Run = (command: string, args?: unknown) => Promise<unknown>;
function AddModal({
  t,
  settings,
  queues,
  onClose,
  run,
}: {
  t: T;
  settings?: Settings;
  queues: Queue[];
  onClose: () => void;
  run: Run;
}) {
  const [url, setUrl] = useState(() => {
      const value = sessionStorage.getItem('clipboardURL') ?? '';
      sessionStorage.removeItem('clipboardURL');
      return value;
    }),
    [directory, setDirectory] = useState(''),
    [filename, setFilename] = useState(''),
    [checksum, setChecksum] = useState(''),
    [credentialId, setCredentialId] = useState(''),
    [queue, setQueue] = useState('default'),
    [description, setDescription] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [navigate, setNavigate] = useState(false);
  async function submit(paused: boolean) {
    setBusy(true);
    try {
      const urls = expandUrls(url);
      if (!urls.length) throw Error(t('url'));
      for (const source of urls)
        await run(navigate ? 'navigate' : 'add', {
          request_id: crypto.randomUUID(),
          url: source,
          filename: urls.length === 1 && filename ? filename : null,
          directory: directory || null,
          checksum: checksum || null,
          queue,
          description,
          paused,
          context: { headers: {}, credential_id: credentialId || null },
        });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t('add')} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <label>
          {t('url')} / {t('batch')}
          <textarea
            autoFocus
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/file.zip"
            rows={3}
            dir="ltr"
          />
        </label>
        <small className="hint">{t('batchHint')}</small>
        <label className="check">
          <input
            type="checkbox"
            checked={navigate}
            onChange={(e) => setNavigate(e.target.checked)}
          />
          {t('navigatePage')}
        </label>
        <small className="hint">{navigate && t('navigateHint')}</small>
        <label>
          {t('credential')}
          <input value={credentialId} onChange={(e) => setCredentialId(e.target.value)} />
        </label>
        <label>
          {t('filename')}
          <input value={filename} onChange={(e) => setFilename(e.target.value)} />
        </label>
        <label>
          {t('directory')}
          <div className="input-row">
            <input
              placeholder={settings?.directory}
              value={directory}
              onChange={(e) => setDirectory(e.target.value)}
            />
            <button
              type="button"
              onClick={async () => {
                const path = await pickDirectory();
                if (path) setDirectory(path);
              }}
            >
              {t('browse')}
            </button>
          </div>
        </label>
        <div className="form-grid">
          <label>
            {t('queues')}
            <select value={queue} onChange={(e) => setQueue(e.target.value)}>
              {queues.length ? (
                queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))
              ) : (
                <option value="default">{t('queues')}</option>
              )}
            </select>
          </label>
          <label>
            {t('checksum')}
            <input
              value={checksum}
              onChange={(e) => setChecksum(e.target.value)}
              pattern="[a-fA-F0-9]{64}"
              dir="ltr"
            />
          </label>
        </div>
        <label>
          {t('description')}
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {error && (
          <div role="alert" className="inline-error">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="button" disabled={busy} onClick={() => void submit(true)}>
            {t('later')}
          </button>
          <button className="primary" disabled={busy}>
            {t('start')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function SettingsPage({ settings, t, run }: { settings: Settings; t: T; run: Run }) {
  const [value, setValue] = useState(settings),
    [saved, setSaved] = useState(false),
    [id, setId] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('');
  const [solverTesting, setSolverTesting] = useState(false);
  const [solverResult, setSolverResult] = useState('');
  const update = (key: keyof Settings, v: unknown) => {
    setValue({ ...value, [key]: v });
    setSaved(false);
  };
  const updateSolver = (patch: Partial<Settings['solver']>) => {
    update('solver', { ...value.solver, ...patch });
    setSolverResult('');
  };
  return (
    <div className="page-content">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await run('settings', value);
          setSaved(true);
        }}
      >
        <section className="card">
          <h2>{t('general')}</h2>
          <div className="form-grid">
            <label>
              {t('language')}
              <select value={value.locale} onChange={(e) => update('locale', e.target.value)}>
                {Object.entries(languages).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('theme')}
              <select value={value.theme} onChange={(e) => update('theme', e.target.value)}>
                {['system', 'light', 'dark'].map((key) => (
                  <option key={key} value={key}>
                    {t(key as Key)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            {t('directory')}
            <div className="input-row">
              <input
                value={value.directory}
                onChange={(e) => update('directory', e.target.value)}
              />
              <button
                type="button"
                onClick={async () => {
                  const p = await pickDirectory();
                  if (p) update('directory', p);
                }}
              >
                {t('browse')}
              </button>
            </div>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.clipboard}
              onChange={(e) => update('clipboard', e.target.checked)}
            />
            {t('clipboard')}
          </label>
        </section>
        <section className="card">
          <h2>{t('networking')}</h2>
          <CaptchaSettings
            value={value.captcha}
            locale={value.locale}
            onChange={(v) => update('captcha', v)}
            saveKey={(id, key) => run('credential', { id, username: '2captcha', password: key })}
            loadBudget={async () =>
              (await run('captcha_budget')) as {
                spent_microusd: number;
                reserved_microusd: number;
                pending: number;
              }
            }
          />

          <fieldset>
            <legend>FlareSolverr</legend>
            <label className="check">
              <input
                type="checkbox"
                checked={value.solver.enabled}
                onChange={(e) => updateSolver({ enabled: e.target.checked })}
              />
              {t('solverEnable')}
            </label>
            <div className="form-grid">
              <label>
                {t('solverEndpoint')}
                <input
                  type="url"
                  dir="ltr"
                  value={value.solver.endpoint}
                  onChange={(e) => updateSolver({ endpoint: e.target.value })}
                />
              </label>
              <label>
                {t('solverTimeout')}
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={value.solver.timeout_seconds}
                  onChange={(e) => updateSolver({ timeout_seconds: Number(e.target.value) })}
                />
              </label>
            </div>
            <p className="hint">{t('solverHint')}</p>
            {value.network.proxy_mode !== 'direct' && <p className="hint">{t('solver_routing')}</p>}
            <button
              type="button"
              disabled={solverTesting}
              onClick={async () => {
                setSolverTesting(true);
                setSolverResult('');
                try {
                  const result = (await run('test_solver', { settings: value.solver })) as {
                    version: string;
                  };
                  setSolverResult(`${t('solverReady')} ${t('solverVersion')}: ${result.version}`);
                } catch {
                  setSolverResult(t('solver_unavailable'));
                } finally {
                  setSolverTesting(false);
                }
              }}
            >
              {t(solverTesting ? 'solverTesting' : 'solverTest')}
            </button>
            <p role="status">{solverResult}</p>
          </fieldset>
          <div className="form-grid">
            <label>
              {t('routing')}
              <select
                value={value.network.proxy_mode}
                onChange={(e) =>
                  update('network', {
                    ...value.network,
                    proxy_mode: e.target.value as Settings['network']['proxy_mode'],
                  })
                }
              >
                {['system', 'direct', 'manual', 'pac'].map((mode) => (
                  <option key={mode} value={mode}>
                    {t(('route_' + mode) as Key)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('httpPolicy')}
              <select
                value={value.network.http_policy}
                onChange={(e) =>
                  update('network', {
                    ...value.network,
                    http_policy: e.target.value as Settings['network']['http_policy'],
                  })
                }
              >
                {['auto', 'http1', 'http2_tls', 'http2_prior_knowledge'].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('authentication')}
              <select
                value={value.network.authentication}
                onChange={(e) =>
                  update('network', {
                    ...value.network,
                    authentication: e.target.value as Settings['network']['authentication'],
                  })
                }
              >
                {['auto', 'basic', 'digest', 'ntlm', 'negotiate'].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('proxyAuth')}
              <select
                value={value.network.proxy_authentication}
                onChange={(e) =>
                  update('network', {
                    ...value.network,
                    proxy_authentication: e.target
                      .value as Settings['network']['proxy_authentication'],
                  })
                }
              >
                {['auto', 'basic', 'digest', 'ntlm', 'negotiate'].map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('pacURL')}
              <input
                value={value.network.pac_url ?? ''}
                onChange={(e) =>
                  update('network', { ...value.network, pac_url: e.target.value || null })
                }
              />
            </label>
            <label>
              {t('caFile')}
              <input
                value={value.network.ca_file ?? ''}
                onChange={(e) =>
                  update('network', { ...value.network, ca_file: e.target.value || null })
                }
              />
            </label>
            {(
              [
                'retries',
                'connect_timeout_seconds',
                'stall_timeout_seconds',
                'checkpoint_milliseconds',
              ] as const
            ).map((key) => (
              <label key={key}>
                {t(key)}
                <input
                  type="number"
                  value={value.network[key]}
                  onChange={(e) =>
                    update('network', { ...value.network, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={value.network.segmented}
              onChange={(e) => update('network', { ...value.network, segmented: e.target.checked })}
            />
            {t('segmented')}
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.network.ftp_tls}
              onChange={(e) => update('network', { ...value.network, ftp_tls: e.target.checked })}
            />
            {t('ftpTLS')}
          </label>
          <div className="form-grid">
            {(
              [
                ['max_jobs', 'maxJobs'],
                ['connections', 'connections'],
                ['host_connections', 'hostConnections'],
                ['speed_limit', 'speedLimit'],
                ['quota_bytes', 'quota'],
                ['quota_minutes', 'quotaWindow'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {t(label)}
                <input
                  type="number"
                  min={key.includes('limit') || key === 'quota_bytes' ? 0 : 1}
                  value={value[key]}
                  onChange={(e) => update(key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
          <label>
            {t('proxy')}
            <input
              dir="ltr"
              value={value.proxy ?? ''}
              placeholder="http://127.0.0.1:8080"
              onChange={(e) => update('proxy', e.target.value || null)}
            />
          </label>
          <label>
            {t('credential')}
            <input
              value={value.proxy_credential ?? ''}
              onChange={(e) => update('proxy_credential', e.target.value || null)}
            />
          </label>
        </section>
        <section className="card">
          <h2>{t('categories')}</h2>
          {value.categories.map((c, i) => (
            <div className="form-grid" key={c.id}>
              <label>
                {t('name')}
                <input
                  value={c.name}
                  onChange={(e) =>
                    update(
                      'categories',
                      value.categories.map((x, n) =>
                        n === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {t('fileTypes')}
                <input
                  value={c.extensions.join(' ')}
                  onChange={(e) =>
                    update(
                      'categories',
                      value.categories.map((x, n) =>
                        n === i ? { ...x, extensions: e.target.value.split(/\s+/) } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                {t('directory')}
                <input
                  value={c.directory}
                  onChange={(e) =>
                    update(
                      'categories',
                      value.categories.map((x, n) =>
                        n === i ? { ...x, directory: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  update(
                    'categories',
                    value.categories.filter((_, n) => n !== i),
                  )
                }
              >
                {t('remove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              update('categories', [
                ...value.categories,
                {
                  id: crypto.randomUUID(),
                  name: t('newCategory'),
                  extensions: [],
                  directory: value.directory,
                },
              ])
            }
          >
            {t('newCategory')}
          </button>
        </section>
        <section className="card">
          <h2>{t('scanner')}</h2>
          <input
            aria-label={t('scanner')}
            value={value.scanner?.executable ?? ''}
            onChange={(e) =>
              update(
                'scanner',
                e.target.value
                  ? {
                      executable: e.target.value,
                      args: value.scanner?.args ?? ['{file}'],
                    }
                  : null,
              )
            }
          />
          {value.scanner && (
            <label>
              {t('scannerArgs')}
              <textarea
                value={value.scanner.args.join('\n')}
                onChange={(e) =>
                  update('scanner', {
                    ...value.scanner!,
                    args: e.target.value.split('\n'),
                  })
                }
              />
            </label>
          )}
          <label>
            {t('components')}
            <input
              value={value.components}
              onChange={(e) => update('components', e.target.value)}
            />
          </label>
        </section>
        <button className="primary">{saved ? t('saved') : t('save')}</button>
      </form>
      <section className="card">
        <h2>{t('siteLogins')}</h2>
        <div className="form-grid">
          <label>
            {t('credential')}
            <input value={id} onChange={(e) => setId(e.target.value)} />
          </label>
          <label>
            {t('username')}
            <input value={username} onChange={(e) => setUsername(e.target.value)} />
          </label>
          <label>
            {t('password')}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
        <button
          disabled={!id}
          onClick={async () => {
            await run('credential', { id, username, password });
            setPassword('');
          }}
        >
          {t('save')}
        </button>
      </section>
      <section className="card">
        <h2>
          {t('export')} / {t('import')}
        </h2>
        <button
          onClick={async () => {
            const value = await run('export');
            const blob = new Blob([JSON.stringify(value, null, 2)], {
              type: 'application/json',
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'downloader-list.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {t('export')}
        </button>
        <label>
          {t('import')}
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                const value = JSON.parse(await file.text());
                await run('import', { jobs: value.jobs });
              }
            }}
          />
        </label>
      </section>
    </div>
  );
}
function QueuesPage({ queues, t, run }: { queues: Queue[]; t: T; run: Run }) {
  const [edit, setEdit] = useState<Queue | null>(null);
  return (
    <div className="page-content">
      <button
        className="primary"
        onClick={() =>
          setEdit({
            id: crypto.randomUUID(),
            name: t('newQueue'),
            enabled: true,
            concurrency: 3,
            order: [],
            start_time: null,
            stop_time: null,
            interval_minutes: null,
            next_run: null,
            synchronize: false,
          })
        }
      >
        <Plus size={16} />
        {t('newQueue')}
      </button>
      {queues.map((q) => (
        <section className="card queue-card" key={q.id}>
          <div>
            <h2>{q.name}</h2>
            <p>
              {q.concurrency} {t('concurrency')} · {q.start_time ?? '—'} → {q.stop_time ?? '—'}
            </p>
          </div>
          <span className="status">{q.enabled ? t('enabled') : t('paused')}</span>
          <button onClick={() => setEdit(q)}>{t('settings')}</button>
        </section>
      ))}
      {edit && (
        <Modal title={t('queues')} onClose={() => setEdit(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await run('queue', edit);
              setEdit(null);
            }}
          >
            <label>
              {t('name')}
              <input
                required
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.enabled}
                onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
              />
              {t('enabled')}
            </label>
            <label>
              {t('concurrency')}
              <input
                type="number"
                min="1"
                max="32"
                value={edit.concurrency}
                onChange={(e) => setEdit({ ...edit, concurrency: Number(e.target.value) })}
              />
            </label>
            <div className="form-grid">
              <label>
                {t('startTime')}
                <input
                  type="time"
                  value={edit.start_time ?? ''}
                  onChange={(e) => setEdit({ ...edit, start_time: e.target.value || null })}
                />
              </label>
              <label>
                {t('stopTime')}
                <input
                  type="time"
                  value={edit.stop_time ?? ''}
                  onChange={(e) => setEdit({ ...edit, stop_time: e.target.value || null })}
                />
              </label>
            </div>
            <label>
              {t('interval')}
              <input
                type="number"
                min="1"
                value={edit.interval_minutes ?? ''}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    interval_minutes: Number(e.target.value) || null,
                  })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={edit.synchronize}
                onChange={(e) => setEdit({ ...edit, synchronize: e.target.checked })}
              />
              {t('synchronize')}
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setEdit(null)}>
                {t('cancel')}
              </button>
              <button className="primary">{t('save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function MediaPage({ t, run }: { t: T; run: Run }) {
  const [url, setUrl] = useState(''),
    [info, setInfo] = useState<any>(null),
    [format, setFormat] = useState(''),
    [audio, setAudio] = useState(false),
    [subs, setSubs] = useState(false),
    [thumb, setThumb] = useState(false),
    [playlist, setPlaylist] = useState(false),
    [container, setContainer] = useState('mp4'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function inspect() {
    setBusy(true);
    setError('');
    try {
      setInfo(await run('inspect_media', { url, context: { headers: {} } }));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-content">
      <section className="card">
        <h2>{t('media')}</h2>
        <label>
          {t('url')}
          <div className="input-row">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" />
            <button disabled={!url || busy} onClick={() => void inspect()}>
              {busy ? t('working') : t('inspect')}
            </button>
          </div>
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        {info && <h3>{info.title}</h3>}
        <div className="form-grid">
          <label>
            {t('format')}
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Best video + audio</option>
              {info?.formats
                ?.filter((f: any) => !f.has_drm)
                .map((f: any) => (
                  <option key={f.format_id} value={f.format_id}>
                    {f.format_id} · {f.resolution ?? f.format_note ?? 'audio'} · {f.ext} ·{' '}
                    {bytes(f.filesize ?? f.filesize_approx)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('container')}
            <select value={container} onChange={(e) => setContainer(e.target.value)}>
              {['mp4', 'mkv', 'webm'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        {[
          [audio, setAudio, 'audio'],
          [subs, setSubs, 'subtitles'],
          [thumb, setThumb, 'thumbnail'],
          [playlist, setPlaylist, 'playlist'],
        ].map(([value, set, key]) => (
          <label className="check" key={key as string}>
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
            />
            {t(key as Key)}
          </label>
        ))}
        <button
          className="primary"
          disabled={!url || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await run('add', {
                request_id: crypto.randomUUID(),
                url,
                filename: info?.title ? info.title + '.' + (audio ? 'mp3' : container) : null,
                directory: null,
                queue: null,
                checksum: null,
                paused: false,
                description: info?.title ?? '',
                context: { headers: {} },
                media: {
                  format: format || null,
                  audio_only: audio,
                  subtitles: subs,
                  thumbnail: thumb,
                  playlist,
                  container,
                },
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('start')}
        </button>
      </section>
    </div>
  );
}
function GrabberPage({ t, run, directory }: { t: T; run: Run; directory: string }) {
  const [projects, setProjects] = useState<any[]>([]),
    [project, setProject] = useState<any>(null),
    [newProject, setNew] = useState(false),
    [chosen, setChosen] = useState<string[]>([]);
  async function reload() {
    try {
      setProjects(await api<any[]>('grabber_list'));
    } catch {}
  }
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, []);
  const current = projects.find((p) => p.id === project?.id) ?? project;
  return (
    <div className="page-content">
      <button
        className="primary"
        onClick={() => {
          setProject({
            id: crypto.randomUUID(),
            name: '',
            url: '',
            directory,
            depth: 2,
            max_pages: 100,
            same_domain: true,
            include: '*.zip,*.pdf,*.jpg,*.png',
            exclude: '',
            min_size: 0,
            max_size: null,
            mirror: false,
            rendered: false,
            private: false,
            found: [],
            visited: [],
            status: 'new',
            interval_minutes: null,
            next_run: null,
          });
          setNew(true);
        }}
      >
        {t('createProject')}
      </button>
      {projects.map((p) => (
        <section key={p.id} className="card queue-card">
          <div>
            <h2>{p.name}</h2>
            <p>
              {safeHost(p.url)} · {p.found_count ?? p.found.length} ·{' '}
              {p.rendered
                ? t(
                    ((
                      {
                        waiting_browser: 'waiting_browser',
                        exploring: 'discoveryExploring',
                        ready: 'discoveryReady',
                        authentication_required: 'discoveryAuthentication',
                        limit_reached: 'discoveryLimit',
                        render_timeout: 'discoveryTimeout',
                        tab_closed: 'discoveryTabClosed',
                        cancelled: 'cancelled',
                      } as Record<string, string>
                    )[p.status] ?? 'working') as Key,
                  )
                : p.status}
            </p>
          </div>
          <button
            onClick={() => {
              setProject(p);
              setChosen(p.found.map((f: any) => f.url));
            }}
          >
            {t('details')}
          </button>
          {p.rendered && (
            <>
              <p role="status">{t('discoveryBrowser')}</p>
              <button
                onClick={() =>
                  void run('grabber_control', { id: p.id, action: 'resume' }).then(reload)
                }
              >
                {t('discoveryResume')}
              </button>
              <button
                onClick={() =>
                  void run('grabber_control', { id: p.id, action: 'cancel' }).then(reload)
                }
              >
                {t('discoveryCancel')}
              </button>
            </>
          )}
          <button
            onClick={async () => {
              await run('grabber_run', { id: p.id });
              await reload();
            }}
          >
            {t('explore')}
          </button>
        </section>
      ))}
      {current && !newProject && (
        <section className="card">
          <h2>{current.name}</h2>
          <label className="check">
            <input
              type="checkbox"
              checked={chosen.length === current.found.length && chosen.length > 0}
              onChange={(e) =>
                setChosen(e.target.checked ? current.found.map((f: any) => f.url) : [])
              }
            />
            {t('selectAll')}
          </label>
          {current.rendered && (
            <RenderedResources id={current.id} count={current.found_count ?? 0} chosen={chosen} onChosen={setChosen} t={t} />
          )}
          {current.found.map((f: any) => (
            <label className="check" key={f.url}>
              <input
                type="checkbox"
                checked={chosen.includes(f.url)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked ? [...chosen, f.url] : chosen.filter((u) => u !== f.url),
                  )
                }
              />
              <span>
                {f.name} · {bytes(f.size)}
              </span>
            </label>
          ))}
          <button
            disabled={!chosen.length}
            className="primary"
            onClick={() =>
              void (async () => {
                for (let index = 0; index < chosen.length; index += 16)
                  await run('grabber_download', {
                    id: current.id,
                    urls: chosen.slice(index, index + 16),
                  });
              })()
            }
          >
            {t('downloadSelected')}
          </button>
        </section>
      )}
      {newProject && project && (
        <Modal title={t('createProject')} onClose={() => setNew(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await run('grabber', project);
              setNew(false);
              await reload();
            }}
          >
            {[
              ['name', 'projectName'],
              ['url', 'url'],
              ['directory', 'directory'],
              ['include', 'include'],
              ['exclude', 'exclude'],
            ].map(([field, key]) => (
              <label key={field}>
                {t(key as Key)}
                <input
                  required={field === 'url' || field === 'name' || field === 'directory'}
                  value={project[field]}
                  onChange={(e) => setProject({ ...project, [field]: e.target.value })}
                />
              </label>
            ))}
            <div className="form-grid">
              {[
                ['depth', 'depth'],
                ['max_pages', 'maxPages'],
              ].map(([field, key]) => (
                <label key={field}>
                  {t(key as Key)}
                  <input
                    type="number"
                    min="0"
                    value={project[field]}
                    onChange={(e) =>
                      setProject({
                        ...project,
                        [field]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {[
              ['same_domain', 'sameDomain'],
              ['mirror', 'mirror'],
              ['private', 'discoveryPrivate'],
            ].map(([field, key]) => (
              <label className="check" key={field}>
                <input
                  type="checkbox"
                  checked={project[field]}
                  onChange={(e) => setProject({ ...project, [field]: e.target.checked })}
                />
                {t(key as Key)}
              </label>
            ))}
            <div className="modal-actions">
              <button type="button" onClick={() => setNew(false)}>
                {t('cancel')}
              </button>
              <button className="primary">{t('save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
function IntegrationPage({ snapshot, t, run }: { snapshot: Snapshot | null; t: T; run: Run }) {
  const [id, setId] = useState(''),
    [diagnostics, setDiagnostics] = useState<unknown>(null),
    [error, setError] = useState('');
  return (
    <div className="page-content">
      <section className="card">
        <h2>{t('health')}</h2>
        <p>{t('nativeHelp')}</p>
        <label>
          {t('extensionId')}
          <div className="input-row">
            <input value={id} onChange={(e) => setId(e.target.value)} dir="ltr" />
            <button
              disabled={!/^[a-p]{32}$/.test(id)}
              onClick={async () => {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  await invoke('register_extension', { chromeId: id });
                  setError(t('saved'));
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              {t('save')}
            </button>
          </div>
        </label>
        {error && <p role="status">{error}</p>}
        <code>downloader register --chrome-id {id || 'EXTENSION_ID'}</code>
      </section>
      <section className="card">
        <h2>{t('components')}</h2>
        {snapshot?.components.map((c) => (
          <div className="component" key={c.name}>
            <strong>{c.name}</strong>
            <span className={c.available ? 'good' : 'bad'}>
              {c.available ? t('supported') : t('unavailable')}
            </span>
          </div>
        ))}
        <p>
          <code>node scripts/components.mjs install</code>
        </p>
      </section>
      <section className="card">
        <h2>{t('diagnostics')}</h2>
        <button onClick={async () => setDiagnostics(await run('diagnostics'))}>
          {t('inspect')}
        </button>
        {diagnostics !== null && <pre>{JSON.stringify(diagnostics, null, 2)}</pre>}
      </section>
    </div>
  );
}
