import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Job } from '../types';
import type { Account } from '../../../extension/src/navigation/accounts/types';
import { accountLabel, accountError } from '../../../extension/src/navigation/accounts/labels';
export function Accounts({ jobs, locale }: { jobs: Job[]; locale: string }) {
  const [editId, setEditId] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]),
    [jobId, setJobId] = useState(''),
    [label, setLabel] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [origin, setOrigin] = useState(''),
    [fill, setFill] = useState(false),
    [mode, setMode] = useState<'free' | 'premium' | 'manual'>('free'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const t = (key: Parameters<typeof accountLabel>[1]) => accountLabel(locale, key);
  const selected = jobs.find((job) => job.id === jobId);
  const reload = () => api<Account[]>('site_account', { action: 'list' }).then(setAccounts);
  useEffect(() => {
    void reload().catch((e) => setError(accountError(locale, e)));
  }, []);
  async function perform(action: unknown) {
    setBusy(true);
    setError('');
    try {
      await api('site_account', action);
      await reload();
    } catch (e) {
      setError(accountError(locale, e));
    } finally {
      setBusy(false);
      setPassword('');
    }
  }
  function choose(id: string) {
    setJobId(id);
    const job = jobs.find((j) => j.id === id);
    try {
      setOrigin(new URL(job?.navigation_url ?? job?.page_url ?? job?.url ?? '').origin);
    } catch {
      setOrigin('');
    }
  }
  function provider(value: string) {
    const host = new URL(value).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(host)
      ? 'local-fixture'
      : host.includes('ddownload')
        ? 'ddownload'
        : host.includes('rapidgator')
          ? 'rapidgator'
          : host === 'gofile.io'
            ? 'gofile'
            : host === 'g4u.to'
              ? 'g4u'
              : 'unsupported';
  }
  return (
    <section className="card" aria-label={t('title')}>
      <h2>{t('title')}</h2>
      <p>{t('pending')}</p>
      <label>
        {t('job')}
        <select value={jobId} onChange={(e) => choose(e.target.value)}>
          <option value="">{t('choose')}</option>
          {jobs
            .filter(
              (j) => j.navigation_scope && !['complete', 'cancelled', 'failed'].includes(j.state),
            )
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.filename}
              </option>
            ))}
        </select>
      </label>
      {!selected?.navigation_scope && <p>{t('scope')}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!selected?.navigation_scope) return;
          void perform({
            action: 'save',
            account: {
              id: editId ?? crypto.randomUUID(),
              label,
              origin,
              provider: provider(origin),
              account_id: username,
              scope: selected.navigation_scope,
              saved_fill: fill,
              credential_ref: null,
            },
            password: password || null,
          });
        }}
      >
        <div className="form-grid">
          <label>
            {t('label')}
            <input required value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {t('account')}
            <input
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            {t('origin')}
            <input required type="url" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </label>
          <label>
            {t('password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={selected?.navigation_scope?.private}
            />
          </label>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={fill}
            onChange={(e) => setFill(e.target.checked)}
            disabled={selected?.navigation_scope?.private}
          />
          {t('fill')}
        </label>
        <button disabled={busy || !selected?.navigation_scope}>{t('save')}</button>
      </form>
      {editId && (
        <button
          type="button"
          onClick={() => {
            setEditId(null);
            setPassword('');
          }}
        >
          {t('cancel')}
        </button>
      )}
      <label>
        {t('mode')}
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="free">{t('free')}</option>
          <option value="premium">{t('premium')}</option>
          <option value="manual">{t('manual')}</option>
        </select>
      </label>
      <ul>
        {accounts.map((a) => (
          <li key={a.id}>
            <strong>{a.label}</strong>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditId(a.id);
                setLabel(a.label);
                setUsername(a.account_id);
                setOrigin(a.origin);
                setFill(a.saved_fill);
                setPassword('');
              }}
            >
              {t('edit')}
            </button>{' '}
            — {a.origin} ({a.scope.browser}
            {a.scope.private ? ' / private' : ''}){' '}
            <button
              disabled={busy || !selected}
              onClick={() =>
                void perform({ action: 'select', job_id: jobId, account_id: a.id, mode })
              }
            >
              {t('select')}
            </button>{' '}
            <button disabled={busy} onClick={() => void perform({ action: 'remove', id: a.id })}>
              {t('remove')}
            </button>
          </li>
        ))}
      </ul>
      <button
        disabled={busy || !selected}
        onClick={() =>
          void perform({ action: 'select', job_id: jobId, account_id: null, mode: 'manual' })
        }
      >
        {t('existing')}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
