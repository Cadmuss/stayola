import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Booking, calendar } from './lib/bookings';

const CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CALENDAR_CLIENT_ID?.trim();

const SCOPE =
  'https://www.googleapis.com/auth/calendar.events.owned';

const API =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  scope?: string;
};

type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (options: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback: (error: { type?: string }) => void;
      }) => {
        requestAccessToken: (options: { prompt: string }) => void;
      };
      hasGrantedAllScopes: (
        response: TokenResponse,
        ...scopes: string[]
      ) => boolean;
    };
  };
};

type Deadline = {
  id: string;
  title: string;
  at: number;
  destination: string;
  platform: string;
};

function googleIdentity() {
  return (
    window as Window & {
      google?: GoogleIdentity;
    }
  ).google;
}

let scriptPromise: Promise<void> | null = null;

function loadGoogle(): Promise<void> {
  if (googleIdentity()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;

    const timer = window.setTimeout(() => {
      script.remove();
      reject(new Error('Google took too long to load. Please try again.'));
    }, 15000);

    script.onload = () => {
      clearTimeout(timer);

      if (googleIdentity()) {
        resolve();
      } else {
        reject(new Error('Google Calendar connection could not load.'));
      }
    };

    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Google could not load. Check your connection.'));
    };

    document.head.appendChild(script);
  }).catch(error => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function collectDeadlines(bookings: Booking[]): Deadline[] {
  const now = Date.now();
  const result: Deadline[] = [];

  for (const booking of bookings) {
    if (booking.state !== 'active') continue;

    const entries: [string | null, string, string][] = [
      [
        booking.policy === 'free' ? booking.cancellationAt : null,
        'Free cancellation ends',
        '0',
      ],
      [
        booking.paid < booking.total ? booking.paymentAt : null,
        'Payment due',
        '1',
      ],
    ];

    for (const [date, title, suffix] of entries) {
      if (!date) continue;

      const at = Date.parse(date);
      if (!Number.isFinite(at) || at <= now) continue;

      // Stable IDs prevent duplicate events when retrying this connection.
      const bookingId = booking.id.replace(/-/g, '').toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(bookingId)) continue;

      result.push({
        id: `57${bookingId}${suffix}`,
        title: `${title} — ${booking.name}`,
        at,
        destination: booking.destination,
        platform: booking.platform,
      });
    }
  }

  return result.sort((a, b) => a.at - b.at);
}

async function request(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);

  try {
    return await fetch(`${API}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkResponse(response: Response) {
  if (response.ok) return;

  if (response.status === 401) {
    throw new Error('Google access expired. Please connect again.');
  }

  const data = await response.json().catch(() => null);

  throw new Error(
    data?.error?.message ||
      `Google Calendar returned an error (${response.status}).`,
  );
}

async function saveDeadline(token: string, deadline: Deadline) {
  const now = Date.now();

  // A deadline may pass while the confirmation dialog is open.
  if (deadline.at <= now) return false;

  const event = {
    summary: deadline.title,
    location: deadline.destination,
    description: [
      `Booking platform: ${deadline.platform}.`,
      'Check the exact deadline against your booking confirmation.',
      'Cancel or manage payment through your booking provider.',
      'Changes in Allthatbook do not automatically update this event.',
    ].join('\n'),
    start: {
      dateTime: new Date(deadline.at).toISOString(),
    },
    end: {
      dateTime: new Date(deadline.at + 15 * 60000).toISOString(),
    },
    transparency: 'transparent',
    reminders: {
      useDefault: false,
      overrides: [7, 3, 1]
        .filter(days => deadline.at - days * 86400000 > now)
        .map(days => ({
          method: 'popup',
          minutes: days * 24 * 60,
        })),
    },
    extendedProperties: {
      private: {
        stayolaEvent: deadline.id,
      },
    },
  };

  let response = await request(token, '', 'POST', {
    id: deadline.id,
    ...event,
  });

  if (response.status === 409) {
    // This deadline was already added through Allthatbook.
    const existing = await request(token, `/${deadline.id}`);
    await checkResponse(existing);
    const previous = await existing.json();

    if (
      previous.status === 'cancelled' ||
      previous.extendedProperties?.private?.stayolaEvent !== deadline.id
    ) {
      throw new Error(
        'An existing calendar event needs checking. Open Google Calendar before trying again.',
      );
    }

    response = await request(
      token,
      `/${deadline.id}`,
      'PATCH',
      event,
    );
  }

  await checkResponse(response);
  return true;
}

function downloadCalendar(bookings: Booking[]) {
  const contents = calendar(bookings);
  if (!contents.includes('BEGIN:VEVENT')) {
    throw new Error('There are no upcoming deadlines to export.');
  }

  const url = URL.createObjectURL(
    new Blob([contents], {
      type: 'text/calendar;charset=utf-8',
    }),
  );

  const link = document.createElement('a');
  link.href = url;
  link.download = 'allthatbook-deadlines.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function CalendarConnect({
  bookings,
  onClose,
}: {
  bookings: Booking[];
  onClose: () => void;
}) {
  const [deadlines] = useState(() => collectDeadlines(bookings));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let active = true;

    if (CLIENT_ID) {
      loadGoogle()
        .then(() => {
          if (active) setReady(true);
        })
        .catch(error => {
          if (active) setError((error as Error).message);
        });
    }

    return () => {
      active = false;
    };
  }, []);

  async function addEvents(token: string) {
    let added = 0;

    try {
      for (const deadline of deadlines) {
        setMessage(`Saving deadline ${added + 1} of ${deadlines.length}…`);

        if (await saveDeadline(token, deadline)) {
          added += 1;
        }
      }

      setFinished(true);
      setMessage(
        `${added} deadline${added === 1 ? '' : 's'} saved to Google Calendar.`,
      );
    } catch (error) {
      setMessage('');
      setError(
        `${added} deadline${added === 1 ? '' : 's'} saved before the error. ${
          (error as Error).message
        } Retrying updates events already added through this connection.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmGoogle() {
    const google = googleIdentity();
    if (!google || !CLIENT_ID || busy) return;

    setError('');
    setMessage('');
    setBusy(true);

    try {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,

        callback: response => {
          if (
            response.error ||
            !response.access_token ||
            !google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)
          ) {
            setBusy(false);
            setError(
              'Calendar permission was not granted. Nothing was added.',
            );
            return;
          }

          // Token is used in memory only; never saved to localStorage.
          void addEvents(response.access_token);
        },

        error_callback: () => {
          setBusy(false);
          setError(
            'Google connection was closed or blocked. Allow the popup and try again.',
          );
        },
      });

      // Called directly from the button click so browsers allow the popup.
      client.requestAccessToken({ prompt: 'select_account' });
    } catch (error) {
      setBusy(false);
      setError((error as Error).message);
    }
  }

  return (
    <div className="modal-overlay confirm-overlay">
      <section
        className="confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-connect-title"
        style={{
          width: 'min(560px, calc(100vw - 24px))',
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
        onKeyDown={event => {
          if (event.key === 'Escape' && !busy) onClose();

          if (event.key === 'Tab') {
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), a[href]',
              ),
            );

            const first = controls[0];
            const last = controls[controls.length - 1];

            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id="calendar-connect-title">
          {finished ? 'Added to Google Calendar' : 'Add deadline reminders?'}
        </h2>

        {!finished && (
          <>
            <p>
              {deadlines.length} upcoming deadline
              {deadlines.length === 1 ? '' : 's'}.
              Alerts 7 days, 3 days and 1 day before.
              Alert times already past are skipped.
            </p>

            <ul
              style={{
                paddingLeft: 20,
                maxHeight: '28vh',
                overflowY: 'auto',
              }}
            >
              {deadlines.map(deadline => (
                <li key={deadline.id} style={{ marginBottom: 12 }}>
                  <strong>{deadline.title}</strong>
                  <br />
                  <small>
                    {new Date(deadline.at).toLocaleString(undefined, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' · your device timezone'}
                  </small>
                </li>
              ))}
            </ul>

            <p>
              Confirm to add these to the primary Google Calendar of the
              account you choose. Existing events added through this
              connection will be updated.
            </p>
          </>
        )}

        {message && <p role="status">{message}</p>}

        {error && (
          <p role="alert" style={{ color: '#b42318', lineHeight: 1.5 }}>
            {error}
          </p>
        )}

        {!CLIENT_ID && (
          <p role="alert">
            Google Calendar connection has not been configured yet.
            File download is still available below.
          </p>
        )}

        {finished ? (
          <>
            <p>
              Check the events and notification permissions in Google Calendar.
              Changes, payments and cancellations in Allthatbook do not
              automatically update these events.
            </p>

            <a
              href="https://calendar.google.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Google Calendar
            </a>
          </>
        ) : (
          <p style={{ fontSize: 13 }}>
            Previously imported .ics events are separate and may duplicate
            these events. This connection does not remove them.
          </p>
        )}

        <div
          className="form-actions"
          style={{ flexWrap: 'wrap', gap: 10, marginTop: 16 }}
        >
          <button
            autoFocus
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            {finished ? 'Done' : 'Cancel'}
          </button>

          {!finished && (
            <>
              <button
                className="secondary"
                disabled={busy || !deadlines.length}
                onClick={() => {
                  try {
                    downloadCalendar(bookings);
                    setError('');
                    setMessage(
                      'File downloaded. Import it into your calendar and check the alerts.',
                    );
                  } catch (error) {
                    setError((error as Error).message);
                  }
                }}
              >
                Download for other calendars
              </button>

              <button
                className="primary"
                disabled={!ready || busy || !deadlines.length}
                onClick={confirmGoogle}
              >
                {busy
                  ? 'Connecting / saving…'
                  : !ready && CLIENT_ID
                    ? 'Loading Google…'
                    : 'Confirm — Google Calendar'}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

let dialogOpen = false;

export function openCalendarConnect(bookings: Booking[]) {
  if (dialogOpen) return;
  dialogOpen = true;

  const previousFocus = document.activeElement as HTMLElement | null;
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);

  function close() {
    root.unmount();
    container.remove();
    dialogOpen = false;
    previousFocus?.focus();
  }

  root.render(
    <CalendarConnect bookings={bookings} onClose={close} />,
  );
}