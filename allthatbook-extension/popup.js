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

