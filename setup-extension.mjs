import fs from 'node:fs';

const site = new URL(process.argv[2] || 'http://localhost:5173');

if (
  site.protocol !== 'https:' &&
  !(site.protocol === 'http:' && site.hostname === 'localhost')
) {
  throw new Error(
    'Use your HTTPS website address, or http://localhost:5173.',
  );
}

if (site.username || site.password) {
  throw new Error('Use a plain website address.');
}

const origin = site.origin;
const appPath = 'src/App.tsx';

if (!fs.existsSync(appPath)) {
  throw new Error('Run inside the folder containing src/App.tsx.');
}

let app = fs.readFileSync(appPath, 'utf8');

if (
  !app.includes('applyImport') ||
  !app.includes('<div className="shell">')
) {
  throw new Error(
    'App.tsx differs from the expected version. No files changed.',
  );
}

if (!app.includes("from './ExtensionImport'")) {
  app =
    "import { ExtensionImport } from './ExtensionImport';\n" + app;

  app = app.replace(
    '<div className="shell">',
    '<div className="shell">\n<ExtensionImport signedIn={signedIn} demo={demo} onSignIn={onSignIn} onResult={applyImport} />',
  );
}

fs.mkdirSync('allthatbook-extension', { recursive: true });

const files = {};

files['allthatbook-extension/manifest.json'] = JSON.stringify(
  {
    manifest_version: 3,
    name: 'Allthatbook — Import a booking',
    version: '0.1.0',
    minimum_chrome_version: '102',
    description:
      'Review an open booking page and send it to Allthatbook.',
    permissions: ['activeTab', 'scripting', 'storage'],
    action: {
      default_popup: 'popup.html',
      default_title: 'Add to Allthatbook',
    },
    background: {
      service_worker: 'worker.js',
      type: 'module',
    },
    externally_connectable: {
      matches: [site.protocol + '//' + site.hostname + '/*'],
    },
  },
  null,
  2,
);

files['allthatbook-extension/config.js'] =
  'export const APP_ORIGIN = ' + JSON.stringify(origin) + ';\n';

files['allthatbook-extension/popup.html'] = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Allthatbook</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>Allthatbook</h1>
  <p>Open one reservation, including its cancellation and payment details.</p>

  <button id="read">Read this booking page</button>

  <section id="preview" hidden>
    <h2>Check the captured text</h2>
    <p id="source"></p>

    <textarea
      id="text"
      maxlength="20000"
      aria-label="Captured booking text"
    ></textarea>

    <p class="small">
      Remove anything unrelated. The text is sent to Anthropic only
      when you choose Read booking in Allthatbook.
    </p>

    <button id="send">Continue in Allthatbook</button>
  </section>

  <p id="status" role="status"></p>
  <script type="module" src="popup.js"></script>
</body>
</html>`;

files['allthatbook-extension/popup.css'] = `
* { box-sizing: border-box; }
body {
  width: 370px;
  margin: 0;
  padding: 22px;
  font: 15px/1.5 Arial, sans-serif;
  color: #243e34;
  background: #f8f9f6;
}
h1 { font-size: 25px; margin: 0 0 10px; }
h2 { font-size: 17px; margin: 18px 0 8px; }
p { margin: 10px 0 16px; }
button {
  width: 100%;
  min-height: 46px;
  background: #254b3b;
  color: white;
  border: 0;
  border-radius: 8px;
  padding: 12px;
  font: 600 15px Arial;
  cursor: pointer;
}
button:disabled { opacity: .55; cursor: wait; }
textarea {
  width: 100%;
  height: 190px;
  padding: 10px;
  border: 1px solid #cbd6c5;
  border-radius: 8px;
  font: 14px/1.5 Arial;
  resize: vertical;
}
.small { font-size: 13px; color: #5d6d58; }
#status { margin-bottom: 0; overflow-wrap: anywhere; }
button:focus-visible, textarea:focus-visible {
  outline: 3px solid #8eaa70;
  outline-offset: 3px;
}
[hidden] { display: none !important; }
`;

files['allthatbook-extension/popup.js'] = String.raw`
const read = document.querySelector('#read');
const send = document.querySelector('#send');
const status = document.querySelector('#status');
const text = document.querySelector('#text');
let source = '';

read.addEventListener('click', async () => {
  read.disabled = true;
  document.querySelector('#preview').hidden = true;
  status.textContent = 'Reading visible booking details…';

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) throw new Error('Open a booking page first.');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },

      func: () => {
        const host = location.hostname.toLowerCase();

        const domains = {
          Agoda: ['agoda.com'],
          'Booking.com': ['booking.com'],
          Airbnb: [
            'airbnb.com',
            'airbnb.co.uk',
            'airbnb.com.sg',
            'airbnb.com.au',
            'airbnb.ca',
          ],
        };

        const provider = Object.entries(domains).find(([, list]) =>
          list.some(domain =>
            host === domain || host.endsWith('.' + domain)
          )
        )?.[0];

        if (!provider) {
          return {
            error: 'Open an Agoda, Booking.com or supported Airbnb reservation page.',
          };
        }

        const selection = window.getSelection()?.toString().trim();
        const main = document.querySelector('main, [role="main"]');

        const visible =
          selection ||
          (main instanceof HTMLElement
            ? main.innerText
            : document.body.innerText);

        const cleaned = visible
          .replace(/\u00a0/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (cleaned.length < 40) {
          return {
            error: 'Not enough details found. Expand the booking details and try again.',
          };
        }

        return {
          source: provider,
          text: cleaned.slice(0, 20000),
          truncated: cleaned.length > 20000,
        };
      },
    });

    const result = results[0]?.result;

    if (!result || result.error) {
      throw new Error(result?.error || 'Could not read this page.');
    }

    source = result.source;
    text.value = result.text;

    document.querySelector('#source').textContent =
      source + ' · Review before continuing';

    document.querySelector('#preview').hidden = false;

    status.textContent = result.truncated
      ? 'This page is long. Only the first 20,000 characters were captured. Check that the deadlines are included, or select the booking text on the page and read again.'
      : 'Missing something? Expand it on the booking page, then read again.';
  } catch (error) {
    status.textContent =
      error.message ||
      'Could not read the page. Refresh it and try again.';
  } finally {
    read.disabled = false;
  }
});

send.addEventListener('click', async () => {
  send.disabled = true;
  read.disabled = true;

  try {
    if (text.value.trim().length < 40) {
      throw new Error('Include the booking details before continuing.');
    }

    const response = await chrome.runtime.sendMessage({
      type: 'prepare-import',
      source,
      text: text.value.trim(),
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Could not open Allthatbook.');
    }

    window.close();
  } catch (error) {
    status.textContent = error.message;
    send.disabled = false;
    read.disabled = false;
  }
});
`;

files['allthatbook-extension/worker.js'] = String.raw`
import { APP_ORIGIN } from './config.js';

const PREFIX = 'import:';
const TTL = 15 * 60 * 1000;
const sources = ['Agoda', 'Booking.com', 'Airbnb'];

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL('popup.html')
  ) return;

  if (message?.type !== 'prepare-import') return;

  (async () => {
    if (
      !sources.includes(message.source) ||
      typeof message.text !== 'string' ||
      message.text.length < 40 ||
      message.text.length > 20000
    ) {
      throw new Error('Invalid booking text.');
    }

    const stored = await chrome.storage.session.get(null);

    const expired = Object.keys(stored).filter(key =>
      key.startsWith(PREFIX) &&
      Date.now() - stored[key].created > TTL
    );

    if (expired.length) {
      await chrome.storage.session.remove(expired);
    }

    const ticket = crypto.randomUUID().replace(/-/g, '');
    const key = PREFIX + ticket;

    const item = {
      text: message.text,
      source: message.source,
      created: Date.now(),
      tabId: null,
    };

    await chrome.storage.session.set({ [key]: item });

    try {
      const tab = await chrome.tabs.create({
        url:
          APP_ORIGIN +
          '/#allthatbook_import=' +
          chrome.runtime.id +
          '.' +
          ticket,
      });

      await chrome.storage.session.set({
        [key]: { ...item, tabId: tab.id },
      });

      respond({ ok: true });
    } catch (error) {
      await chrome.storage.session.remove(key);
      throw error;
    }
  })().catch(error =>
    respond({ ok: false, error: error.message })
  );

  return true;
});

chrome.runtime.onMessageExternal.addListener(
  (message, sender, respond) => {
    let allowed = false;

    try {
      allowed = new URL(sender.url).origin === APP_ORIGIN;
    } catch {}

    if (
      !allowed ||
      !sender.tab ||
      (sender.frameId !== undefined && sender.frameId !== 0)
    ) return;

    if (
      !['read-import', 'ack-import'].includes(message?.type) ||
      !/^[a-f0-9]{32}$/.test(message.ticket || '')
    ) return;

    (async () => {
      const key = PREFIX + message.ticket;
      const item = (await chrome.storage.session.get(key))[key];

      if (!item || Date.now() - item.created > TTL) {
        await chrome.storage.session.remove(key);

        respond({
          ok: false,
          error: 'Import expired. Capture the booking again.',
        });
        return;
      }

      if (item.tabId === null) {
        respond({ ok: false, retry: true });
        return;
      }

      if (item.tabId !== sender.tab.id) {
        respond({
          ok: false,
          error: 'Open the tab created by the extension.',
        });
        return;
      }

      if (message.type === 'ack-import') {
        await chrome.storage.session.remove(key);
        respond({ ok: true });
      } else {
        respond({
          ok: true,
          text: item.text,
          source: item.source,
          created: item.created,
        });
      }
    })().catch(() =>
      respond({
        ok: false,
        error: 'Could not transfer the booking.',
      })
    );

    return true;
  },
);

chrome.tabs.onRemoved.addListener(async tabId => {
  const stored = await chrome.storage.session.get(null);

  const keys = Object.keys(stored).filter(key =>
    key.startsWith(PREFIX) && stored[key].tabId === tabId
  );

  if (keys.length) await chrome.storage.session.remove(keys);
});
`;

files['src/ExtensionImport.tsx'] = String.raw`
import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { ImportResult } from './ImportModal';

type Pending = {
  text: string;
  source: string;
  created: number;
};

type Reply = Partial<Pending> & {
  ok?: boolean;
  retry?: boolean;
  error?: string;
};

type Runtime = {
  lastError?: { message?: string };
  sendMessage: (
    id: string,
    message: unknown,
    callback: (reply: Reply) => void,
  ) => void;
};

const KEY = 'allthatbook-extension-draft-v1';
let transfer: Promise<Pending | null> | null = null;

function valid(value: unknown): value is Pending {
  const p = value as Pending | null;

  return (
    !!p &&
    typeof p.text === 'string' &&
    p.text.length >= 40 &&
    p.text.length <= 20000 &&
    ['Agoda', 'Booking.com', 'Airbnb'].includes(p.source) &&
    Number.isFinite(p.created) &&
    Date.now() - p.created < 30 * 60 * 1000
  );
}

function receive(): Promise<Pending | null> {
  if (transfer) return transfer;

  transfer = (async () => {
    const match = location.hash.match(
      /^#allthatbook_import=([a-p]{32})\.([a-f0-9]{32})$/,
    );

    if (!match) {
      try {
        const cached = JSON.parse(
          sessionStorage.getItem(KEY) || 'null',
        );

        if (valid(cached)) return cached;
        sessionStorage.removeItem(KEY);
      } catch {}

      return null;
    }

    const runtime = (
      window as Window & {
        chrome?: { runtime?: Runtime };
      }
    ).chrome?.runtime;

    if (!runtime) {
      throw new Error(
        'The extension could not connect. Check its website address and reload the extension.',
      );
    }

    const [, extensionId, ticket] = match;

    const message = (type: string) =>
      new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(
            new Error(
              'Extension connection timed out. Capture the page again.',
            ),
          ),
          8000,
        );

        runtime.sendMessage(
          extensionId,
          { type, ticket },
          reply => {
            clearTimeout(timer);

            if (runtime.lastError) {
              reject(
                new Error(
                  runtime.lastError.message || 'Extension unavailable.',
                ),
              );
            } else {
              resolve(reply || {});
            }
          },
        );
      });

    let response = await message('read-import');

    for (
      let attempt = 0;
      response.retry && attempt < 5;
      attempt++
    ) {
      await new Promise(resolve => setTimeout(resolve, 250));
      response = await message('read-import');
    }

    if (!response.ok || !valid(response)) {
      throw new Error(
        response.error ||
        'Could not receive the booking. Capture it again.',
      );
    }

    const pending: Pending = {
      text: response.text,
      source: response.source,
      created: response.created,
    };

    sessionStorage.setItem(KEY, JSON.stringify(pending));

    history.replaceState(
      history.state,
      '',
      location.pathname + location.search,
    );

    await message('ack-import').catch(() => {});

    return pending;
  })();

  return transfer;
}

export function ExtensionImport({
  signedIn,
  demo,
  onSignIn,
  onResult,
}: {
  signedIn: boolean;
  demo: boolean;
  onSignIn?: () => void;
  onResult: (result: ImportResult) => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    receive()
      .then(value => {
        if (active) setPending(value);
      })
      .catch(error => {
        if (active) setError(error.message);
      });

    return () => {
      active = false;
    };
  }, []);

  function close() {
    sessionStorage.removeItem(KEY);

    if (location.hash.startsWith('#allthatbook_import=')) {
      history.replaceState(
        history.state,
        '',
        location.pathname + location.search,
      );
    }

    transfer = null;
    setPending(null);
    setError('');
    setDismissed(true);
  }

  async function readBooking() {
    if (!pending || !signedIn || !supabase || busy || demo) return;

    setBusy(true);
    setError('');

    try {
      const { data, error } = await supabase.functions.invoke(
        'import-booking',
        {
          body: {
            text: pending.text,
            files: [],
          },
        },
      );

      if (error) throw error;

      if (
        !data?.draft ||
        typeof data.draft !== 'object' ||
        Array.isArray(data.draft) ||
        !Array.isArray(data.warnings) ||
        !data.warnings.every(
          (value: unknown) => typeof value === 'string',
        ) ||
        !Array.isArray(data.missing) ||
        !data.missing.every(
          (value: unknown) => typeof value === 'string',
        )
      ) {
        throw new Error(
          'Could not read the booking. Try the PDF import instead.',
        );
      }

      close();
      onResult(data as ImportResult);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (dismissed || (!pending && !error)) return null;

  return (
    <div className="modal-overlay confirm-overlay">
      <section
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-import-title"
        style={{
          width: 'min(580px, 100%)',
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <h2 id="extension-import-title">
          {pending
            ? 'Import from ' + pending.source
            : 'Extension import'}
        </h2>

        {pending && (
          <>
            <p>
              Check the text below. You’ll review the booking fields
              before saving.
            </p>

            <label htmlFor="extension-booking-text">
              Captured booking details
            </label>

            <textarea
              id="extension-booking-text"
              value={pending.text}
              disabled={busy}
              maxLength={20000}
              onChange={event =>
                setPending({
                  ...pending,
                  text: event.target.value,
                })
              }
              style={{
                display: 'block',
                width: '100%',
                minHeight: 170,
                padding: 12,
                fontSize: 16,
                margin: '10px 0',
                border: '1px solid #ccd7c5',
                borderRadius: 8,
              }}
            />

            <p>
              Read booking sends this text to Anthropic.
              Nothing is saved until you confirm the booking form.
            </p>

            {!signedIn && (
              <p>
                Sign in to Allthatbook to read this booking.
                Your captured text will remain in this tab.
              </p>
            )}

            {demo && (
              <p>Exit the example workspace before importing.</p>
            )}
          </>
        )}

        {error && (
          <p role="alert" style={{ color: '#a33d32' }}>
            {error}
          </p>
        )}

        <div
          className="form-actions"
          style={{ flexWrap: 'wrap' }}
        >
          <button
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>

          {pending && !signedIn && onSignIn && (
            <button
              className="primary"
              onClick={() => {
                sessionStorage.setItem(
                  KEY,
                  JSON.stringify(pending),
                );
                transfer = null;
                onSignIn();
              }}
            >
              Sign in to import
            </button>
          )}

          {pending && signedIn && (
            <button
              className="primary"
              disabled={
                busy ||
                demo ||
                pending.text.trim().length < 40
              }
              onClick={readBooking}
            >
              {busy ? 'Reading…' : 'Read booking'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
`;

if (!fs.existsSync('App.tsx.before-extension')) {
  fs.copyFileSync(appPath, 'App.tsx.before-extension');
}

for (const [file, content] of Object.entries(files)) {
  fs.writeFileSync(file, content.trimStart() + '\n');
}

fs.writeFileSync(appPath, app);

console.log(
  'Extension created in allthatbook-extension. Website: ' + origin,
);
console.log(
  'App.tsx connected. Run npm run build, then load the extension folder in Chrome.',
);