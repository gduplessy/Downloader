import { useEffect, useState } from 'react';
import { api } from '../../api';
import { type Key } from '../../../../../packages/shared/src/i18n';
interface File {
  url: string;
  name: string;
  size: number | null;
}
export function RenderedResources({
  id,
  count,
  chosen,
  onChosen,
  t,
}: {
  id: string;
  count: number;
  chosen: string[];
  onChosen: (urls: string[]) => void;
  t: (key: Key) => string;
}) {
  const [page, setPage] = useState<{ items: File[]; total: number; offset: number }>({
    items: [],
    total: 0,
    offset: 0,
  });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void api<typeof page>('grabber_results', { id, offset, limit: 16 })
      .then((value) => {
        if (live) {
          setPage(value);
          setError('');
        }
      })
      .catch((error) => {
        if (live) setError(String(error));
      });
    return () => {
      live = false;
    };
  }, [id, offset, count]);
  return (
    <>
      <p role="status">
        {error ||
          `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} / ${page.total}`}
      </p>
      <button
        onClick={() => onChosen([...new Set([...chosen, ...page.items.map((file) => file.url)])])}
      >
        {t('selectAll')}
      </button>
      {page.items.map((file) => (
        <label className="check" key={file.url}>
          <input
            type="checkbox"
            checked={chosen.includes(file.url)}
            onChange={(event) =>
              onChosen(
                event.target.checked
                  ? [...chosen, file.url]
                  : chosen.filter((url) => url !== file.url),
              )
            }
          />
          <span>{file.name}</span>
        </label>
      ))}
      <div className="modal-actions">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 16))}>
          {t('discoveryPrevious')}
        </button>
        <button disabled={offset + 16 >= page.total} onClick={() => setOffset(offset + 16)}>
          {t('discoveryNext')}
        </button>
      </div>
    </>
  );
}
