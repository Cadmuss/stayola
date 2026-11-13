import { useEffect, useRef, useState } from 'react';
import { X, LoaderCircle, Upload, ExternalLink, FileText } from 'lucide-react';
import { supabase } from './lib/supabase';
import type { Booking } from './lib/bookings';

export type ImportResult = {
  draft: Partial<Booking>;
  warnings: string[];
  missing: string[];
};

type Item = {
  type: string;
  data: string;
};

type Platform = 'Agoda' | 'Booking.com' | 'Airbnb' | 'Other';

const MAX_FILES = 3;

const GUIDES: Record<
  Platform,
  {
    steps: string[];
    tip: string;
    help?: string;
  }
> = {
  Agoda: {
    steps: [
      'Open your Agoda booking confirmation email.',
      'Download the attached PDF booking voucher.',
      'Upload the voucher below.',
    ],
    tip: 'No email? Sign in to Agoda and request another booking confirmation.',
    help: 'https://www.agoda.com/info/contact.html',
  },
  'Booking.com': {
    steps: [
      'Open your booking confirmation email or booking details.',
      'On a computer, choose Print, then Save as PDF.',
      'Upload the saved confirmation below.',
    ],
    tip: 'Use the booking confirmation, not just a payment receipt. On your phone, screenshots work too.',
    help: 'https://www.booking.com/customer-service.html',
  },
  Airbnb: {
    steps: [
      'On the Airbnb website, open Trips and select your stay.',
      'Under Reservation details, choose Print details.',
      'Choose Save as PDF, then upload it below.',
    ],
    tip: 'If Print details is unavailable on your phone, use a computer or upload screenshots.',
    help: 'https://www.airbnb.com/help/article/2639',
  },
  Other: {
    steps: [
      'Open your booking confirmation email or reservation page.',
      'Download its PDF, or use Print → Save as PDF on a computer.',
      'Upload the PDF or screenshots below.',
    ],
    tip: 'Include the stay dates, price, cancellation deadline and payment date where available.',
  },
};

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(String(reader.result).split(',')[1] ?? '');
    };

    reader.onerror = () => {
      reject(new Error('Could not read the file.'));
    };

    reader.readAsDataURL(blob);
  });
}

async function prepare(file: File): Promise<Item> {
  const isPdf =
    file.type === 'application/pdf' ||
    (!file.type && /\.pdf$/i.test(file.name));

  if (isPdf) {
    if (file.size > 3_000_000) {
      throw new Error(`${file.name} is larger than 3 MB.`);
    }

    return {
      type: 'application/pdf',
      data: await readBase64(file),
    };
  }

  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name}: use a PDF or screenshot.`);
  }

  if (file.size > 10_000_000) {
    throw new Error(`${file.name} is larger than 10 MB.`);
  }

  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `${file.name} could not be opened. Try a PNG or JPEG screenshot.`,
    );
  }

  try {
    const scale = Math.min(
      1,
      1800 / Math.max(bitmap.width, bitmap.height),
    );

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');

    if (!context) {
      throw new Error('Could not process the image.');
    }

    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>(resolve => {
      canvas.toBlob(resolve, 'image/jpeg', 0.85);
    });

    if (!blob) {
      throw new Error('Could not process the image.');
    }

    return {
      type: 'image/jpeg',
      data: await readBase64(blob),
    };
  } finally {
    bitmap.close();
  }
}

export function ImportModal({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (result: ImportResult) => void;
}) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const guide = platform ? GUIDES[platform] : null;

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };

    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [busy, onClose]);

  function addFiles(list: FileList | File[]) {
    const incoming = Array.from(list);
    if (!incoming.length) return;

    if (files.length + incoming.length > MAX_FILES) {
      setError(`You can add up to ${MAX_FILES} files. Remove one first.`);
      return;
    }

    setError('');
    setFiles(old => [...old, ...incoming]);
  }

  async function run() {
    setError('');

    if (!supabase) {
      setError('Import is not configured yet.');
      return;
    }

    const trimmedText = text.trim();

    if (!trimmedText && !files.length) {
      setError('Choose a PDF, add a screenshot or paste your booking text.');
      return;
    }

    setBusy(true);

    try {
      const prepared = await Promise.all(files.map(prepare));

      if (
        prepared.reduce((total, file) => total + file.data.length, 0) >
        9_000_000
      ) {
        throw new Error(
          'These files are too large together. Use smaller PDFs or screenshots.',
        );
      }

      const { data, error: requestError } =
        await supabase.functions.invoke('import-booking', {
          body: {
            text: trimmedText,
            files: prepared,
          },
        });

      if (requestError) {
        let message = requestError.message;

        try {
          const response = (
            requestError as unknown as { context?: Response }
          ).context;

          const body = await response?.json();

          if (typeof body?.error === 'string') {
            message = body.error;
          }
        } catch {
          // Keep the original error message.
        }

        throw new Error(message);
      }

      if (
        !data ||
        !data.draft ||
        typeof data.draft !== 'object' ||
        Array.isArray(data.draft) ||
        !Array.isArray(data.warnings) ||
        !data.warnings.every((item: unknown) => typeof item === 'string') ||
        (data.missing !== undefined &&
          (!Array.isArray(data.missing) ||
            !data.missing.every(
              (item: unknown) => typeof item === 'string',
            )))
      ) {
        throw new Error(
          'The booking could not be read correctly. Please try again.',
        );
      }

      onResult({
        draft: data.draft,
        warnings: data.warnings,
        missing: data.missing ?? [],
      });
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay">
      <section
        className="modal import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="modal-header">
          <div>
            <h2 id="import-title">Import a booking</h2>
          </div>

          <button
            className="icon-button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close import"
          >
            <X />
          </button>
        </div>

        <div className="form-body">
          <section className="import-section">
            <h3 className="import-step-title">
              <span>1</span>
              Find your booking PDF
            </h3>

            <div
              className="import-platforms"
              role="group"
              aria-label="Choose a booking platform for instructions"
            >
              {(Object.keys(GUIDES) as Platform[]).map(name => (
                <button
                  key={name}
                  type="button"
                  disabled={busy}
                  aria-pressed={platform === name}
                  aria-controls="import-platform-guide"
                  onClick={() =>
                    setPlatform(old => (old === name ? null : name))
                  }
                >
                  {name}
                </button>
              ))}
            </div>

            <div id="import-platform-guide" aria-live="polite">
              {guide && (
                <div className="import-guide">
                  <ol>
                    {guide.steps.map(step => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>

                  <p>{guide.tip}</p>

                  {guide.help && (
                    <a
                      href={guide.help}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {platform} help <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="import-section">
            <h3 className="import-step-title">
              <span>2</span>
              Upload your confirmation
            </h3>

            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept="image/*,application/pdf,.pdf"
              disabled={busy}
              onChange={event => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = '';
              }}
            />

            <button
              type="button"
              className="import-upload"
              disabled={busy || files.length >= MAX_FILES}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={23} />
              <strong>
                {files.length ? 'Add another file' : 'Choose PDF or screenshots'}
              </strong>
              <span>Up to 3 files · PDFs up to 3 MB each</span>
            </button>

            {files.length > 0 && (
              <ul className="import-files">
                {files.map((file, index) => (
                  <li key={`${file.name}-${index}`}>
                    <FileText size={18} />

                    <span>{file.name}</span>

                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Remove ${file.name}`}
                      onClick={() => {
                        setFiles(old =>
                          old.filter((_, itemIndex) => itemIndex !== index),
                        );
                        setError('');
                      }}
                    >
                      <X size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <details className="import-text-option">
              <summary>Paste text instead</summary>

              <label htmlFor="booking-import-text">
                Booking confirmation text
              </label>

              <textarea
                id="booking-import-text"
                rows={4}
                maxLength={20000}
                disabled={busy}
                value={text}
                placeholder="Paste your confirmation here…"
                onChange={event => setText(event.target.value)}
                onPaste={event => {
                  const images = Array.from(
                    event.clipboardData.files,
                  ).filter(file => file.type.startsWith('image/'));

                  if (images.length) {
                    event.preventDefault();
                    addFiles(images);
                  }
                }}
              />

              <small>You can also paste a screenshot here.</small>
            </details>
          </section>

          <p className="import-review-note">
            Include cancellation and payment details. You’ll review before saving.
          </p>

          <p className="import-privacy-note">
            Files and text are sent to Anthropic to read your booking.
          </p>

          {error && (
            <p className="validation" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="form-actions">
          <div className="spacer" />

          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>

          <button
            className="primary"
            type="button"
            disabled={busy || (!files.length && !text.trim())}
            onClick={run}
          >
            {busy ? (
              <>
                <LoaderCircle size={17} className="spin" />
                Reading…
              </>
            ) : (
              'Read booking'
            )}
          </button>
        </div>
      </section>
    </div>
  );
}