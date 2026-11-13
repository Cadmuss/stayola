import fs from 'node:fs';

const dir = 'allthatbook-extension';
const bridgePath = 'src/ExtensionImport.tsx';
const backendPath = 'supabase/functions/import-booking/index.ts';

if (
  !fs.existsSync(dir + '/config.js') ||
  !fs.existsSync(bridgePath)
) {
  throw new Error(
    'Run this in the project where setup-extension.mjs was already run.',
  );
}

const oldConfig = fs.readFileSync(dir + '/config.js', 'utf8');

const address =
  process.argv[2] ||
  oldConfig.match(/APP_ORIGIN\s*=\s*(['"])(.*?)\1/)?.[2];

const site = new URL(address);

if (
  site.username ||
  site.password ||
  (
    site.protocol !== 'https:' &&
    !(site.protocol === 'http:' && site.hostname === 'localhost')
  )
) {
  throw new Error(
    'Use your HTTPS website address or http://localhost:5173.',
  );
}

/* Let the website receive another import in the same tab. */
let bridge = fs.readFileSync(bridgePath, 'utf8');

const oldEffect =
  /useEffect\(\(\) => \{\s*let active = true;[\s\S]*?\}, \[\]\);/;

if (!bridge.includes('ALLTHATBOOK_MULTIPAGE_V2')) {
  if (
    !oldEffect.test(bridge) ||
    !bridge.includes('if (transfer) return transfer;')
  ) {
    throw new Error(
      'ExtensionImport.tsx differs from the expected version. No files changed.',
    );
  }

  bridge = bridge.replace(
    'if (transfer) return transfer;',
    "if (transfer && (!location.hash.startsWith('#allthatbook_import=') || transferHash === location.hash)) return transfer;\n  transferHash = location.hash;",
  );

  bridge = 'let transferHash = "";\n' + bridge;

  bridge = bridge.replace(
    oldEffect,
    `useEffect(() => {
      // ALLTHATBOOK_MULTIPAGE_V2: accept another capture in this same tab.
      let active = true;
      let request = 0;

      const load = () => {
        const current = ++request;
        setDismissed(false);
        setError('');

        receive().then(value => {
          if (active && current === request) setPending(value);
        }).catch(error => {
          if (active && current === request) setError(error.message);
        });
      };

      const onHash = () => {
        if (location.hash.startsWith('#allthatbook_import=')) load();
      };

      load();
      window.addEventListener('hashchange', onHash);

      return () => {
        active = false;
        window.removeEventListener('hashchange', onHash);
      };
    }, []);`,
  );
}

/* Ask the import service to handle conflicting information carefully. */
let backend = null;

if (fs.existsSync(backendPath)) {
  backend = fs.readFileSync(backendPath, 'utf8');

  if (!backend.includes('ALLTHATBOOK_MULTIPAGE_RULES')) {
    if (!backend.includes('Rules:')) {
      throw new Error(
        'Import function has changed. No files changed.',
      );
    }

    backend = backend.replace(
      'Rules:',
      `Rules:
- ALLTHATBOOK_MULTIPAGE_RULES: The input may contain several captured pages for ONE reservation. Combine complementary information, but never merge different reservations. If clearly different reservation references or properties are present, set isBooking to false.
- Different cancellation and payment deadlines are separate fields, not a conflict. If pages give conflicting values for the SAME field and the current value is not explicitly identified, return null for that field and explain the alternatives in warnings and notes. Never silently prefer the last page.
`,
    );
  }
}

const manifest = JSON.parse(
  fs.readFileSync(dir + '/manifest.json', 'utf8'),
);

const pattern = site.protocol + '//' + site.hostname + '/*';

manifest.version = '0.2.0';
manifest.description =
  'Collect booking details across pages and review them in Allthatbook.';
manifest.host_permissions = [pattern];
manifest.externally_connectable = { matches: [pattern] };

const files = {};

files[dir + '/manifest.json'] =
  JSON.stringify(manifest, null, 2);

files[dir + '/config.js'] =
  'export const APP_ORIGIN = ' + JSON.stringify(site.origin) + ';';

files[dir + '/popup.html'] = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Allthatbook</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>Allthatbook</h1>
  <p>Collect pages for <strong>one reservation</strong>.</p>

  <label for="label">What’s on this page?</label>
  <select id="label">
    <option>Booking overview</option>
    <option>Cancellation terms</option>
    <option>Payment details</option>
    <option>Other details</option>
  </select>

  <button id="capture">Start import</button>

  <section id="draft" hidden>
    <h2 id="heading"></h2>
    <ul id="pages"></ul>

    <p class="small">
      Add any remaining pages before reviewing.
    </p>

    <button id="review">Review booking</button>

    <button id="clear" class="secondary">
      Clear draft / start another booking
    </button>
  </section>

  <p id="status" role="status"></p>

  <p class="small">
    Captured text stays in this browser session until transferred.
    Allthatbook asks before sending it to Anthropic.
  </p>

  <script type="module" src="popup.js"></script>
</body>
</html>`;

files[dir + '/popup.css'] = `
* { box-sizing: border-box; }

body {
  width: 380px;
  margin: 0;
  padding: 22px;
  font: 15px/1.5 Arial, sans-serif;
  color: #243e34;
  background: #f8f9f6;
}

h1 { font-size: 25px; margin: 0 0 10px; }
h2 { font-size: 17px; margin: 20px 0 10px; }
p { margin: 10px 0 16px; }

label {
  display: block;
  font-weight: 600;
  margin-bottom: 6px;
}

select {
  width: 100%;
  min-height: 44px;
  padding: 10px;
  margin-bottom: 10px;
  border: 1px solid #cbd6c5;
  border-radius: 8px;
  background: white;
  font: inherit;
}

button {
  width: 100%;
  min-height: 44px;
  background: #254b3b;
  color: white;
  border: 0;
  border-radius: 8px;
  padding: 11px;
  font: 600 15px Arial;
  cursor: pointer;
}

button:disabled { opacity: .55; cursor: wait; }

.secondary {
  margin-top: 10px;
  background: white;
  color: #254b3b;
  border: 1px solid #ccd6c6;
}

.small { font-size: 13px; color: #5d6d58; }

#status { overflow-wrap: anywhere; }

#pages {
  list-style: none;
  padding: 0;
  margin: 0;
}

#pages li {
  padding: 10px;
  border: 1px solid #dce4d6;
  border-radius: 8px;
  background: white;
  margin-bottom: 8px;
}

summary {
  cursor: pointer;
  overflow-wrap: anywhere;
}

pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: 13px/1.5 Arial;
  max-height: 140px;
  overflow: auto;
}

.remove {
  width: auto;
  min-height: 36px;
  background: none;
  color: #914c3a;
  padding: 8px 0;
  font-size: 13px;
}

button:focus-visible,
select:focus-visible,
summary:focus-visible {
  outline: 3px solid #8eaa70;
  outline-offset: 3px;
}

[hidden] { display: none !important; }
`;

files[dir + '/popup.js'] = String.raw`
const $ = id => document.getElementById(id);

let state = { pages: [] };
let busy = false;

async function call(type, data = {}) {
  const response = await chrome.runtime.sendMessage({
    type,
    ...data,
  });

  if (!response?.ok) {
    throw new Error(
      response?.error || 'Could not update the draft.',
    );
  }

  return response;
}

function render() {
  $('capture').textContent =
    state.pages.length ? 'Add this page' : 'Start import';

  $('draft').hidden = !state.pages.length;

  $('heading').textContent =
    state.source + ' · ' + state.pages.length + '/5 pages';

  $('pages').replaceChildren();

  for (const page of state.pages) {
    const li = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');

    summary.textContent =
      page.label +
      ' · ' +
      page.text.length.toLocaleString() +
      ' characters';

    const pre = document.createElement('pre');
    pre.textContent = page.text;

    details.append(summary, pre);

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = 'Remove page';

    remove.onclick = () => act(async () => {
      state = (
        await call('remove-page', { id: page.id })
      ).draft;

      $('status').textContent = 'Page removed.';
    });

    li.append(details, remove);
    $('pages').append(li);
  }

  document.querySelectorAll('button,select').forEach(element => {
    element.disabled = busy;
  });
}

async function act(task) {
  if (busy) return;

  busy = true;
  render();
  $('status').textContent = '';

  try {
    await task();
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    busy = false;
    render();
  }
}

$('capture').onclick = () => act(async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.id) {
    throw new Error('Open the booking page first.');
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },

    func: () => {
      const host = location.hostname.toLowerCase();

      const providers = {
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

      const source = Object.entries(providers).find(
        ([, domains]) => domains.some(
          domain =>
            host === domain ||
            host.endsWith('.' + domain),
        ),
      )?.[0];

      if (!source) {
        return {
          error: 'Open an Agoda, Booking.com or supported Airbnb booking page.',
        };
      }

      const main = document.querySelector(
        'main, [role="main"]',
      );

      const selected =
        window.getSelection()?.toString().trim();

      const text = (
        selected ||
        (
          main instanceof HTMLElement
            ? main.innerText
            : document.body.innerText
        )
      )
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (text.length < 40) {
        return {
          error: 'Expand the booking details first, then try again.',
        };
      }

      if (text.length > 16000) {
        return {
          error: 'This page has too much text. Highlight only the booking details, then click Add this page again.',
        };
      }

      return { source, text };
    },
  });

  const page = results[0]?.result;

  if (!page || page.error) {
    throw new Error(
      page?.error || 'Could not read this page.',
    );
  }

  const response = await call('add-page', {
    ...page,
    label: $('label').value,
  });

  state = response.draft;

  $('status').textContent = response.duplicate
    ? 'This exact text is already captured.'
    : 'Added. Open the next details page, then click the extension again.';
});

$('clear').onclick = () => {
  if (
    confirm(
      'Discard these captured pages and start a different booking?',
    )
  ) {
    act(async () => {
      state = (await call('clear-draft')).draft;
      $('status').textContent = 'Ready for a new booking.';
    });
  }
};

$('review').onclick = () => act(async () => {
  await call('review-draft');
  window.close();
});

act(async () => {
  state = (await call('get-draft')).draft;
});
`;

files[dir + '/worker.js'] = String.raw`
import { APP_ORIGIN } from './config.js';

const DRAFT = 'multipage-draft-v2';
const TAB = 'allthatbook-review-tab';
const TTL = 30 * 60 * 1000;

const sources = ['Agoda', 'Booking.com', 'Airbnb'];

const labels = [
  'Booking overview',
  'Cancellation terms',
  'Payment details',
  'Other details',
];

let queue = Promise.resolve();

function serial(task, respond) {
  const result = queue.then(task);

  queue = result.catch(() => {});

  result.then(
    respond,
    error => respond({
      ok: false,
      error: error.message,
    }),
  );

  return true;
}

function empty() {
  return {
    id: crypto.randomUUID(),
    version: 0,
    source: '',
    pages: [],
    updated: Date.now(),
  };
}

async function draft() {
  const value = (
    await chrome.storage.session.get(DRAFT)
  )[DRAFT];

  if (value && Date.now() - value.updated < TTL) {
    return value;
  }

  await chrome.storage.session.remove(DRAFT);
  return empty();
}

function combined(draft) {
  return (
    'Booking platform: ' +
    draft.source +
    '\nCaptured pages for one reservation:\n\n' +
    draft.pages.map(
      (page, index) =>
        '--- Page ' +
        (index + 1) +
        ': ' +
        page.label +
        ' ---\n' +
        page.text,
    ).join('\n\n')
  );
}

function isApp(tab) {
  try {
    const url = new URL(tab.url);

    return (
      url.origin === APP_ORIGIN &&
      !/access_token=|refresh_token=|error_description=/.test(
        url.hash,
      )
    );
  } catch {
    return false;
  }
}

async function appTab() {
  const id = (
    await chrome.storage.session.get(TAB)
  )[TAB];

  if (Number.isInteger(id)) {
    try {
      const tab = await chrome.tabs.get(id);
      if (isApp(tab)) return tab;
    } catch {}
  }

  const url = new URL(APP_ORIGIN);

  const candidates = await chrome.tabs.query({
    url: url.protocol + '//' + url.hostname + '/*',
  });

  return candidates
    .filter(isApp)
    .sort(
      (a, b) => Number(b.active) - Number(a.active),
    )[0] || null;
}

chrome.runtime.onMessage.addListener(
  (message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL('popup.html')
    ) return;

    if (
      ![
        'get-draft',
        'add-page',
        'remove-page',
        'clear-draft',
        'review-draft',
      ].includes(message?.type)
    ) return;

    return serial(async () => {
      let d = await draft();

      if (message.type === 'clear-draft') {
        await chrome.storage.session.remove(DRAFT);
        return { ok: true, draft: empty() };
      }

      if (message.type === 'add-page') {
        if (
          !sources.includes(message.source) ||
          !labels.includes(message.label) ||
          typeof message.text !== 'string' ||
          message.text.length < 40 ||
          message.text.length > 16000
        ) {
          throw new Error('Invalid capture.');
        }

        if (
          d.pages.length &&
          d.source !== message.source
        ) {
          throw new Error(
            'This draft is from ' +
            d.source +
            '. Clear it before starting another booking.',
          );
        }

        if (
          d.pages.some(page => page.text === message.text)
        ) {
          return {
            ok: true,
            draft: d,
            duplicate: true,
          };
        }

        if (d.pages.length >= 5) {
          throw new Error(
            'Maximum 5 pages. Remove an unnecessary capture first.',
          );
        }

        d = {
          ...d,
          source: message.source,
          version: d.version + 1,
          updated: Date.now(),
          pages: [
            ...d.pages,
            {
              id: crypto.randomUUID(),
              label: message.label,
              text: message.text,
            },
          ],
        };

        if (combined(d).length > 19500) {
          throw new Error(
            'Too much text combined. Remove a long capture and highlight just the relevant details before adding it again.',
          );
        }

        await chrome.storage.session.set({
          [DRAFT]: d,
        });
      }

      if (message.type === 'remove-page') {
        d = {
          ...d,
          version: d.version + 1,
          updated: Date.now(),
          pages: d.pages.filter(
            page => page.id !== message.id,
          ),
        };

        if (!d.pages.length) d = empty();

        await chrome.storage.session.set({
          [DRAFT]: d,
        });
      }

      if (message.type !== 'review-draft') {
        return { ok: true, draft: d };
      }

      if (!d.pages.length) {
        throw new Error('Capture a page first.');
      }

      const ticket =
        crypto.randomUUID().replace(/-/g, '');

      const key = 'import:' + ticket;

      const item = {
        text: combined(d),
        source: d.source,
        created: Date.now(),
        tabId: null,
        draftId: d.id,
        version: d.version,
      };

      const stored = await chrome.storage.session.get(null);

      const expired = Object.keys(stored).filter(
        key =>
          key.startsWith('import:') &&
          Date.now() - stored[key].created > TTL,
      );

      if (expired.length) {
        await chrome.storage.session.remove(expired);
      }

      await chrome.storage.session.set({
        [key]: item,
      });

      let tab;

      try {
        const existing = await appTab();

        const url = new URL(
          existing
            ? existing.url
            : APP_ORIGIN + '/',
        );

        url.hash =
          'allthatbook_import=' +
          chrome.runtime.id +
          '.' +
          ticket;

        tab = existing
          ? await chrome.tabs.update(existing.id, {
              url: url.href,
              active: true,
            })
          : await chrome.tabs.create({
              url: url.href,
            });

        await chrome.storage.session.set({
          [TAB]: tab.id,
          [key]: {
            ...item,
            tabId: tab.id,
          },
        });
      } catch {
        await chrome.storage.session.remove(key);

        throw new Error(
          'Could not open Allthatbook. Your captured pages are still saved. Try again.',
        );
      }

      try {
        await chrome.windows.update(
          tab.windowId,
          { focused: true },
        );
      } catch {}

      return { ok: true };
    }, respond);
  },
);

chrome.runtime.onMessageExternal.addListener(
  (message, sender, respond) => {
    let allowed = false;

    try {
      allowed =
        new URL(sender.url).origin === APP_ORIGIN;
    } catch {}

    if (
      !allowed ||
      !sender.tab ||
      (
        sender.frameId !== undefined &&
        sender.frameId !== 0
      )
    ) return;

    if (
      !['read-import', 'ack-import'].includes(
        message?.type,
      ) ||
      !/^[a-f0-9]{32}$/.test(
        message.ticket || '',
      )
    ) return;

    return serial(async () => {
      const key = 'import:' + message.ticket;

      const item = (
        await chrome.storage.session.get(key)
      )[key];

      if (
        !item ||
        Date.now() - item.created > TTL
      ) {
        await chrome.storage.session.remove(key);

        return {
          ok: false,
          error: 'Transfer expired. Click Review booking again.',
        };
      }

      if (item.tabId !== sender.tab.id) {
        return {
          ok: false,
          error: 'Use the Allthatbook tab selected by the extension.',
        };
      }

      if (message.type === 'read-import') {
        return {
          ok: true,
          text: item.text,
          source: item.source,
          created: item.created,
        };
      }

      const d = await draft();

      // Preserve captures added after this transfer started.
      if (
        d.id === item.draftId &&
        d.version === item.version
      ) {
        await chrome.storage.session.remove(DRAFT);
      }

      await chrome.storage.session.remove(key);

      return { ok: true };
    }, respond);
  },
);

chrome.tabs.onRemoved.addListener(tabId => {
  serial(async () => {
    const values =
      await chrome.storage.session.get(null);

    const keys = Object.keys(values).filter(
      key =>
        key.startsWith('import:') &&
        values[key].tabId === tabId,
    );

    if (values[TAB] === tabId) keys.push(TAB);

    if (keys.length) {
      await chrome.storage.session.remove(keys);
    }

    return { ok: true };
  }, () => {});
});
`;

files[bridgePath] = bridge;

if (backend !== null) {
  files[backendPath] = backend;
}

for (const [file, contents] of Object.entries(files)) {
  if (
    fs.existsSync(file) &&
    !fs.existsSync(file + '.before-multipage')
  ) {
    fs.copyFileSync(
      file,
      file + '.before-multipage',
    );
  }

  fs.writeFileSync(
    file,
    contents.trimStart() + '\n',
  );
}

console.log(
  'Multi-page capture installed. Allthatbook address: ' +
  site.origin,
);

console.log(
  'Build/deploy the website and import function, then reload the extension in chrome://extensions.',
);