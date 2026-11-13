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

