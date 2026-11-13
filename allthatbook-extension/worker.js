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

