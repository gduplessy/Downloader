import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { showChallenge } from './page';
vi.mock('./geometry', () => ({
  solveOpenCircle: () => ({ point: { x: 45, y: 55 } }),
  toCss: () => ({ x: 45, y: 55 }),
}));
afterEach(() => vi.unstubAllGlobals());
async function fixture(
  mutateDigest = 0,
  replacement: 'value' | 'node' | 'duplicate' = 'value',
) {
  const nodes: any[] = [];
  const node = (tag = 'div'): any => {
    const n: any = {
      tagName: tag.toUpperCase(),
      isConnected: true,
      textContent: '',
      value: '',
      name: '',
      disabled: false,
      style: {},
      dataset: {},
      children: [],
      append(...children: any[]) {
        this.children.push(...children);
      },
      querySelector() {
        return this.children.find((n: any) => n.tagName === 'BUTTON');
      },
      setAttribute() {},
      hasAttribute() {
        return false;
      },
      addEventListener() {},
      focus() {},
      remove() {
        this.isConnected = false;
      },
      attachShadow() {
        return node('shadow');
      },
      getBoundingClientRect() {
        return {
          left: 0,
          top: 0,
          right: 240,
          bottom: 120,
          width: 240,
          height: 120,
        };
      },
      getContext() {
        return {
          drawImage() {},
          getImageData() {
            return {};
          },
        };
      },
      toDataURL() {
        return 'data:image/png;base64,fixture';
      },
    };
    nodes.push(n);
    return n;
  };
  const host = node('input');
  host.name = 'selected_host';
  host.value = 'gofile.io';
  const csrf = node('input');
  csrf.name = 'csrf';
  csrf.value = 'fixture-csrf';
  const x = node('input'),
    y = node('input'),
    submit = node('button');
  submit.name = 'submit';
  const image = node('img');
  Object.assign(image, {
    complete: true,
    naturalWidth: 240,
    naturalHeight: 120,
    currentSrc: 'http://fixture/image',
    dataset: { expiresAt: String(Date.now() + 300000) },
  });
  const form = node('form');
  Object.assign(form, {
    action: 'http://fixture/submit',
    method: 'post',
    enctype: 'application/x-www-form-urlencoded',
  });
  const controls: any = {
    'input[name=captcha_x]': x,
    'input[name=captcha_y]': y,
    'input[name=csrf]': csrf,
    'input[name=selected_host]': host,
    'button[type=submit]': submit,
  };
  form.querySelector = (key: string) => controls[key] ?? null;
  form.querySelectorAll = (key: string) =>
    controls[key] ? [controls[key]] : [];
  image.closest = () => form;
  image.getAttribute = () => 'Click the open circle';
  let submitted = 0;
  form.requestSubmit = () => submitted++;
  const doc: any = {
    location: { href: 'http://fixture/page', origin: 'http://fixture' },
    activeElement: null,
    documentElement: node('html'),
    createElement: node,
    querySelectorAll: () => [image],
    elementFromPoint: () => image,
    defaultView: {
      innerWidth: 1000,
      innerHeight: 1000,
      getComputedStyle: () => ({
        objectFit: 'fill',
        borderLeftWidth: '0',
        borderRightWidth: '0',
        borderTopWidth: '0',
        borderBottomWidth: '0',
        paddingLeft: '0',
        paddingRight: '0',
        paddingTop: '0',
        paddingBottom: '0',
      }),
    },
  };
  const extraHosts: string[] = [];
  vi.stubGlobal(
    'FormData',
    class {
      getAll(name: string) {
        return name === 'selected_host'
          ? [controls['input[name=selected_host]'].value, ...extraHosts]
          : [];
      }
      entries() {
        return [
          ...[controls['input[name=selected_host]'].value, ...extraHosts].map(
            (value) => ['selected_host', value],
          ),
          ['csrf', csrf.value],
        ][Symbol.iterator]();
      }
    },
  );
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  let digests = 0;
  vi.stubGlobal('crypto', {
    subtle: {
      digest: async (_: string, bytes: Uint8Array) => {
        const value = createHash('sha256').update(bytes).digest();
        if (++digests === mutateDigest) {
          if (replacement === 'duplicate') extraHosts.push('ddownload.com');
          else if (replacement === 'node') {
            host.isConnected = false;
            const next = node('input');
            next.name = 'selected_host';
            next.value = 'ddownload.com';
            controls['input[name=selected_host]'] = next;
          } else host.value = 'ddownload.com';
        }
        await Promise.resolve();
        return value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        );
      },
    },
  });
  const ctx: any = {
    scope: {
      browser: 'firefox',
      profile: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
      private: false,
      cookie_store_id: 'firefox-default',
      container_id: null,
      partition_key: null,
      claim_generation: 1,
    },
    sourceGeneration: 1,
    documentGeneration: 1,
    documentNonce: 'c3b45e0f-227f-41fc-b9c5-af170af9a65d',
    selectedHost: 'gofile.io',
    locale: 'en',
  };
  const authorize = vi.fn(async () => true);
  await showChallenge(
    doc,
    {
      context: async () => ctx,
      authorize,
      paid: async () => {
        throw Error('Paid disabled');
      },
    },
    1,
    () => {},
  );
  const local = nodes.find(
    (n) => n.tagName === 'BUTTON' && n.textContent === 'Solve locally',
  );
  expect(local).toBeTruthy();
  local.onclick();
  return {
    get submitted() {
      return submitted;
    },
    get status() {
      return nodes.find((n) => n.tagName === 'P')?.textContent;
    },
    authorize,
  };
}
it('submits an unchanged challenge exactly once for the authorized host', async () => {
  const f = await fixture();
  await vi.waitFor(() => expect(f.submitted).toBe(1));
  expect(f.authorize).toHaveBeenCalledTimes(1);
});
it('rejects host replacement during initial asynchronous binding capture', async () => {
  const f = await fixture(1);
  await vi.waitFor(() =>
    expect(f.status).toBe(
      'Unsupported or expired challenge. Complete it in the page.',
    ),
  );
  expect(f.submitted).toBe(0);
  expect(f.authorize).not.toHaveBeenCalled();
});
it('rejects host replacement during final digest before synchronous submission', async () => {
  const f = await fixture(11);
  await vi.waitFor(() =>
    expect(f.status).toBe(
      'Unsupported or expired challenge. Complete it in the page.',
    ),
  );
  expect(f.submitted).toBe(0);
  expect(f.authorize).toHaveBeenCalledTimes(1);
});

for (const [phase, at] of [
  ['initial', 1],
  ['final', 11],
] as const)
  it(
    'rejects hidden host node replacement during ' + phase + ' digest',
    async () => {
      const f = await fixture(at, 'node');
      await vi.waitFor(() =>
        expect(f.status).toBe(
          'Unsupported or expired challenge. Complete it in the page.',
        ),
      );
      expect(f.submitted).toBe(0);
    },
  );

it('rejects a second successful named selected_host control in the serialized form', async () => {
  const f = await fixture(1, 'duplicate');
  await vi.waitFor(() =>
    expect(f.status).toBe(
      'Unsupported or expired challenge. Complete it in the page.',
    ),
  );
  expect(f.submitted).toBe(0);
});
