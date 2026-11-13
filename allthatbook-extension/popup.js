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

