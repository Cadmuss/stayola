let transferHash = "";
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
  if (transfer && (!location.hash.startsWith('#allthatbook_import=') || transferHash === location.hash)) return transfer;
  transferHash = location.hash;

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



