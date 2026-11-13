import { ExtensionImport } from './ExtensionImport';
import { openCalendarConnect } from './CalenderConnect';
import { useEffect, useState } from 'react';
import { listBookings, saveBooking, deleteBooking } from './lib/repository';
import { supabase } from './lib/supabase';
import {
  listGuestBookings,
  saveGuestBooking,
  deleteGuestBooking,
} from './lib/guestStore';
import { ImportModal, type ImportResult } from './ImportModal';
import {
  ArrowUpRight,
  Plus,
  Search,
  LayoutDashboard,
  CalendarDays,
  Archive,
  ArrowDownToLine,
  X,
  Check,
  MapPin,
  ArrowRight,
  Plane,
  ShieldCheck,
  Wallet,
  Clock3,
  MoreHorizontal,
  Settings2,
  ExternalLink,
  LoaderCircle,
  ChevronDown,
  Upload,
} from 'lucide-react';
import {
  type Booking,
  bookingSchema,
  money,
  nextDeadline,
  status,
  countdown,
  currentFee,
  calendar,
} from './lib/bookings';

function uuid() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;

  const value = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function blank(): Booking {
  return {
    id: uuid(),
    revision: 0,
    name: '',
    destination: '',
    trip: '',
    platform: 'Agoda',
    reference: '',
    checkIn: '',
    checkOut: '',
    currency: 'SGD',
    total: 0,
    paid: 0,
    policy: 'free',
    cancellationAt: null,
    paymentAt: null,
    fee: null,
    offset: '+09:00',
    state: 'active',
    url: '',
    notes: '',
  };
}

function dateLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function localTime(at: string | null, offset: string) {
  if (!at) return '';

  const sign = offset[0] === '-' ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);

  return new Date(
    Date.parse(at) + sign * (hours * 60 + minutes) * 60000,
  )
    .toISOString()
    .slice(0, 16);
}

function when(at: string, offset: string) {
  return `${localTime(at, offset).replace('T', ' · ')} (UTC${offset})`;
}

function examples(): Booking[] {
  const day = (days: number) =>
    new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

  return [
    {
      ...blank(),
      name: 'A little stay in Tokyo',
      destination: 'Tokyo, Japan',
      trip: 'Japan getaway',
      total: 48000,
      currency: 'JPY',
      checkIn: day(25),
      checkOut: day(29),
      cancellationAt: new Date(Date.now() + 2 * 864e5).toISOString(),
      paymentAt: new Date(Date.now() + 4 * 864e5).toISOString(),
      fee: 48000,
    },
    {
      ...blank(),
      name: 'Weekend by the bay',
      destination: 'Yokohama, Japan',
      platform: 'Booking.com',
      trip: 'Japan getaway',
      total: 18000,
      paid: 18000,
      currency: 'JPY',
      checkIn: day(29),
      checkOut: day(31),
      cancellationAt: new Date(Date.now() + 12 * 864e5).toISOString(),
      fee: 9000,
    },
  ];
}

function download(name: string, data: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

type HomeProps = {
  previewOnly?: boolean;
  signedIn?: boolean;
  onSignIn?: () => void;
};

export default function Home({
  previewOnly = false,
  signedIn = false,
  onSignIn,
}: HomeProps) {
  const [guestCount, setGuestCount] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [demo, setDemo] = useState(previewOnly);
  const [sample, setSample] = useState<Booking[]>(
    previewOnly ? examples() : [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState('Overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All statuses');
  const [trip, setTrip] = useState('All trips');
  const [platform, setPlatform] = useState('All platforms');
  const [editing, setEditing] = useState<Booking | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<{
    id: string;
    warnings: string[];
    missing: string[];
  } | null>(null);

  async function load() {
    if (previewOnly) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (signedIn) {
        setBookings(await listBookings());
        setGuestCount(listGuestBookings().length);
      } else {
        setBookings(listGuestBookings());
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [signedIn, previewOnly]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        setEditing(null);
        setInfo(false);
        setDeleteId(null);
        setMenu(false);
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [saving]);

  const data = demo ? sample : bookings;
  const active = data.filter(booking => booking.state === 'active');

  const deadlines = active
    .map(booking => ({
      booking,
      deadline: nextDeadline(booking, now),
    }))
    .filter(item => item.deadline)
    .sort(
      (a, b) =>
        Date.parse(a.deadline!.at) - Date.parse(b.deadline!.at),
    );

  function totals(getAmount: (booking: Booking) => number) {
    const amounts: Record<string, number> = {};

    active.forEach(booking => {
      amounts[booking.currency] =
        (amounts[booking.currency] || 0) + getAmount(booking);
    });

    return (
      Object.entries(amounts)
        .map(([currency, amount]) => money(amount, currency))
        .join(' · ') || '—'
    );
  }

  function overlaps(booking: Booking) {
    return active.filter(
      other =>
        other.id !== booking.id &&
        other.checkIn < booking.checkOut &&
        booking.checkIn < other.checkOut,
    );
  }

  const filtered = data
    .filter(booking => {
      const matchesView =
        view === 'Archive'
          ? booking.state !== 'active'
          : booking.state === 'active';

      const matchesUpcoming =
        view !== 'Upcoming' || !!nextDeadline(booking, now);

      const matchesSearch = [
        booking.name,
        booking.destination,
        booking.trip,
        booking.reference,
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase());

      return (
        matchesView &&
        matchesUpcoming &&
        matchesSearch &&
        (filter === 'All statuses' || status(booking, now) === filter) &&
        (trip === 'All trips' || booking.trip === trip) &&
        (platform === 'All platforms' || booking.platform === platform)
      );
    })
    .sort(
      (a, b) =>
        Date.parse(nextDeadline(a, now)?.at || '9999-01-01') -
          Date.parse(nextDeadline(b, now)?.at || '9999-01-01') ||
        a.checkIn.localeCompare(b.checkIn),
    );

  async function save(booking: Booking) {
    const parsed = bookingSchema.safeParse(booking);

    if (!parsed.success) {
      setToast(parsed.error.issues[0].message);
      return;
    }

    setSaving(true);

    try {
      let saved = parsed.data;

      if (demo) {
        setSample(old =>
          old.some(item => item.id === saved.id)
            ? old.map(item => (item.id === saved.id ? saved : item))
            : [...old, saved],
        );
      } else {
        saved = signedIn
          ? await saveBooking(saved)
          : saveGuestBooking(saved);

        setBookings(old =>
          old.some(item => item.id === saved.id)
            ? old.map(item => (item.id === saved.id ? saved : item))
            : [...old, saved],
        );
      }

      setEditing(null);

      const needsDetails =
        saved.policy === 'unknown' ||
        saved.total === 0 ||
        (saved.paid < saved.total && !saved.paymentAt);

      setToast(
        demo
          ? 'Example updated'
          : needsDetails
            ? 'Booking saved. Check missing costs or deadlines before exporting.'
            : 'Booking saved',
      );
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const booking = data.find(item => item.id === deleteId);
    if (!booking) return;

    setSaving(true);

    try {
      if (demo) {
        setSample(old => old.filter(item => item.id !== booking.id));
      } else {
        if (signedIn) {
          await deleteBooking(booking);
        } else {
          deleteGuestBooking(booking.id);
        }

        setBookings(old => old.filter(item => item.id !== booking.id));
      }

      setDeleteId(null);
      setEditing(null);
      setToast(
        'Booking deleted. Remove any previously exported calendar events too.',
      );
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function importGuest() {
    setSaving(true);

    try {
      for (const guestBooking of listGuestBookings()) {
        const saved = await saveBooking({
          ...guestBooking,
          revision: 0,
        });

        deleteGuestBooking(guestBooking.id);

        setBookings(old =>
          old.some(item => item.id === saved.id)
            ? old.map(item => (item.id === saved.id ? saved : item))
            : [...old, saved],
        );
      }

      setToast('Bookings moved to your account');
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setGuestCount(listGuestBookings().length);
      setSaving(false);
    }
  }

  function applyImport(result: ImportResult) {
    const booking: Booking = {
      ...blank(),
      ...result.draft,
      id: uuid(),
      revision: 0,
      state: 'active',
    };

    setImporting(false);
    setImported({
      id: booking.id,
      warnings: result.warnings,
      missing: result.missing ?? [],
    });
    setEditing(booking);
  }

  function exportCalendar() {
    setMenu(false);
  
    if (demo) {
      setToast('Exit the example workspace to add your own calendar reminders.');
      return;
    }
  
    openCalendarConnect(data);
  }

  function switchDemo() {
    if (previewOnly) return;

    setNow(Date.now());
    setDemo(!demo);

    if (!demo) setSample(examples());

    setQuery('');
    setTrip('All trips');
    setFilter('All statuses');
    setPlatform('All platforms');
    setMenu(false);
  }

  return (
    <div className="shell">
<ExtensionImport signedIn={signedIn} demo={demo} onSignIn={onSignIn} onResult={applyImport} />
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-icon">a</span>
          Allthatbook<span className="brand-dot">.</span>
        </a>

        <div className="workspace-label">YOUR TRAVEL SPACE</div>

        <nav>
          {[
            { name: 'Overview', icon: LayoutDashboard },
            { name: 'Upcoming', icon: CalendarDays },
            { name: 'Archive', icon: Archive },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${view === name ? 'selected' : ''}`}
              onClick={() => {
                setView(name);
                setFilter('All statuses');
              }}
            >
              <Icon size={19} />
              {name}
              {name === 'Upcoming' && deadlines.length > 0 && (
                <span className="count">{deadlines.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <div className="mini-orbit">
            <Plane size={24} />
          </div>
          <h3>
            Less tracking.
            <br />
            More travelling.
          </h3>
          <p>
            Your stays and deadlines,
            <br />
            all in one place.
          </p>
        </div>

        <div className="sidebar-bottom">
          <button onClick={() => setInfo(true)}>
            <Settings2 size={17} />
            About your workspace
          </button>

          <div className="profile">
            <span>A</span>
            <div>
              My workspace
              <small>
                {demo
                  ? 'Example workspace'
                  : signedIn
                    ? 'Personal account'
                    : 'Saved on this device'}
              </small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{view}</strong>
          </div>

          <div className="top-actions">
            <button
              disabled={previewOnly}
              className="text-button"
              onClick={switchDemo}
            >
              {demo ? 'Exit example' : 'Try an example'}
              <ArrowUpRight size={14} />
            </button>

            <span className="private-tag">
              <span />
              {demo
                ? 'Example'
                : signedIn
                  ? 'Private bookings'
                  : 'On this device'}
            </span>

            {!previewOnly && !signedIn && onSignIn && (
              <button className="text-button" onClick={onSignIn}>
                Sign in to save
              </button>
            )}

            {!previewOnly && signedIn && (
              <button
                className="text-button"
                onClick={async () => {
                  if (!supabase) return;
                  const result = await supabase.auth.signOut();
                  if (result.error) setToast(result.error.message);
                }}
              >
                Sign out
              </button>
            )}
          </div>
        </header>

        <main>
          <div className="page-title">
            <div>
              <div className="eyebrow">A LITTLE PEACE OF MIND</div>
              <h1>
                {view === 'Overview'
                  ? 'Your stays, in order.'
                  : view === 'Upcoming'
                    ? 'A little heads-up.'
                    : 'Your travel history.'}
              </h1>
              <p>
                {view === 'Overview'
                  ? 'Keep the plans. Skip the surprises.'
                  : view === 'Upcoming'
                    ? 'Cancellation and payment deadlines, nearest first.'
                    : 'Cancelled and completed reservations.'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!previewOnly &&
                (signedIn ? (
                  <button
                    className="secondary"
                    onClick={() => setImporting(true)}
                  >
                    <Upload size={17} />
                    Import
                  </button>
                ) : (
                  onSignIn && (
                    <button className="secondary" onClick={onSignIn}>
                      Sign in to import
                    </button>
                  )
                ))}

              <button
                className="primary"
                onClick={() => setEditing(blank())}
              >
                <Plus size={18} />
                Add booking
              </button>
            </div>
          </div>

          {demo && (
            <div className="demo-banner">
              Example workspace · Changes here won’t affect your bookings.
              {!previewOnly && (
                <button onClick={switchDemo}>
                  Back to my bookings <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}

          {!demo && !signedIn && !previewOnly && (
            <div className="demo-banner">
              Saved on this device only.
              {onSignIn && (
                <button onClick={onSignIn}>
                  Sign in to keep your bookings <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}

          {!demo && signedIn && guestCount > 0 && (
            <div className="demo-banner">
              {guestCount} booking{guestCount === 1 ? '' : 's'} saved on
              this device.
              <button disabled={saving} onClick={importGuest}>
                Move to my account <ArrowRight size={15} />
              </button>
            </div>
          )}

          {!demo && error && (
            <div className="error-banner">
              {error} <button onClick={load}>Retry</button>
            </div>
          )}

          <section className="stats">
            <div className="stat">
              <div className="stat-label">
                Active bookings
                <span><Plane size={17} /></span>
              </div>
              <strong>{active.length.toString().padStart(2, '0')}</strong>
              <small>
                {new Set(active.map(booking => booking.trip).filter(Boolean)).size}{' '}
                trips planned
              </small>
            </div>

            <div className="stat">
              <div className="stat-label">
                Unpaid balance
                <span><Wallet size={17} /></span>
              </div>
              <strong className="money">
                {totals(booking => booking.total - booking.paid)}
              </strong>
              <small>Across active reservations</small>
            </div>

            <div className="stat">
              <div className="stat-label">
                Due within 7 days
                <span><Clock3 size={17} /></span>
              </div>
              <strong>
                {deadlines
                  .filter(item => Date.parse(item.deadline!.at) - now <= 7 * 864e5)
                  .length.toString().padStart(2, '0')}
              </strong>
              <small>Includes overdue payments</small>
            </div>

            <div className="stat">
              <div className="stat-label">
                Cancellation cost now
                <span><ShieldCheck size={17} /></span>
              </div>
              <strong className="money">
                {totals(booking => currentFee(booking, now) ?? 0)}
              </strong>
              <small>
                {active.some(booking => currentFee(booking, now) === null)
                  ? 'Some charges need verification'
                  : 'Based on recorded booking terms'}
              </small>
            </div>
          </section>

          <div className="financial-line">
            <span>
              Total booking value{' '}
              <strong>{totals(booking => booking.total)}</strong>
            </span>
            <span>
              Already paid{' '}
              <strong>{totals(booking => booking.paid)}</strong>
            </span>
          </div>

          <div className="content-grid">
            <section className="booking-section">
              <div className="section-heading">
                <h2>
                  {view === 'Archive' ? 'Past bookings' : 'Your bookings'}{' '}
                  <span>{filtered.length}</span>
                </h2>

                <div className="export-wrap">
                  <button
                    className="icon-button"
                    aria-label="Export options"
                    aria-expanded={menu}
                    onClick={() => setMenu(!menu)}
                  >
                    <ArrowDownToLine size={18} />
                    <ChevronDown size={13} />
                  </button>

                  {menu && (
                    <div className="export-menu">
                      <button onClick={exportCalendar}>
                        Add deadline reminders to calendar
                      </button>
                      <button
                        onClick={() => {
                          download(
                            'allthatbook-bookings.json',
                            JSON.stringify(data, null, 2),
                            'application/json',
                          );
                          setMenu(false);
                        }}
                      >
                        Download booking backup
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="filters">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Search bookings"
                    placeholder="Search stays, places, trips..."
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                  />
                </div>

                <select
                  aria-label="Filter by status"
                  value={filter}
                  onChange={event => setFilter(event.target.value)}
                >
                  {[
                    'All statuses',
                    'Free cancellation',
                    'Expiring soon',
                    'Non-refundable',
                    'Needs verification',
                    'Cancelled',
                    'Completed',
                  ].map(value => <option key={value}>{value}</option>)}
                </select>
              </div>

              <div className="secondary-filters">
                <select
                  aria-label="Filter by trip"
                  value={trip}
                  onChange={event => setTrip(event.target.value)}
                >
                  <option>All trips</option>
                  {Array.from(new Set(data.map(booking => booking.trip).filter(Boolean)))
                    .map(value => <option key={value}>{value}</option>)}
                </select>

                <select
                  aria-label="Filter by platform"
                  value={platform}
                  onChange={event => setPlatform(event.target.value)}
                >
                  {[
                    'All platforms',
                    'Agoda',
                    'Airbnb',
                    'Booking.com',
                    'Direct',
                    'Other',
                  ].map(value => <option key={value}>{value}</option>)}
                </select>

                <span>Sorted by next deadline</span>
              </div>

              {loading && !demo ? (
                <div className="empty">
                  <LoaderCircle className="spin" />
                  <p>Loading your bookings…</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="empty">
                  <div className="ticket-art">
                    <span /><Plane size={32} /><span />
                  </div>
                  <h3>
                    {data.length
                      ? 'No matching bookings'
                      : 'Your next trip starts here.'}
                  </h3>
                  <p>
                    {data.length
                      ? 'Try another search or filter.'
                      : 'Add your first stay. We’ll keep the dates in order.'}
                  </p>

                  {!data.length && (
                    <button
                      className="primary"
                      onClick={() => setEditing(blank())}
                    >
                      <Plus size={17} /> Add your first booking
                    </button>
                  )}

                  <div className="empty-benefits">
                    <span><Check size={14} /> Track deadlines</span>
                    <span><Check size={14} /> Plan payments</span>
                  </div>
                </div>
              ) : (
                <div className="booking-list">
                  {filtered.map(booking => {
                    const bookingStatus = status(booking, now);
                    const deadline = nextDeadline(booking, now);
                    const overlapping = overlaps(booking);

                    return (
                      <article className="booking-card" key={booking.id}>
                        <div className="card-top">
                          <div className="stay-icon"><MapPin size={23} /></div>

                          <div className="stay-title">
                            <div className="platform">
                              {booking.platform}
                              {booking.trip && (
                                <><span>·</span>{booking.trip}</>
                              )}
                            </div>
                            <h3>
                              <button onClick={() => setEditing(booking)}>
                                {booking.name}
                              </button>
                            </h3>
                            <p>{booking.destination}</p>
                          </div>

                          <button
                            className="icon-button"
                            aria-label={`Edit ${booking.name}`}
                            onClick={() => setEditing(booking)}
                          >
                            <MoreHorizontal size={21} />
                          </button>
                        </div>

                        <div className="card-detail">
                          <div>
                            <small>STAY DATES</small>
                            <strong>
                              {dateLabel(booking.checkIn)} — {dateLabel(booking.checkOut)}{' '}
                              <span>{booking.checkIn.slice(0, 4)}</span>
                            </strong>
                          </div>
                          <div>
                            <small>TOTAL COST</small>
                            <strong>{money(booking.total, booking.currency)}</strong>
                          </div>
                          <div>
                            <small>PAYMENT</small>
                            <strong>
                              {booking.total === 0
                                ? 'Check cost'
                                : booking.paid === booking.total
                                  ? 'Paid'
                                  : booking.paid > 0
                                    ? 'Partially paid'
                                    : 'Unpaid'}
                            </strong>
                          </div>
                        </div>
                        {booking.state === 'active' && (
  <div className="booking-calendar-actions">
    <button
      type="button"
      className="booking-calendar-button"
      onClick={() => {
        if (demo) {
          setToast(
            'Exit the example workspace to add your own calendar reminders.',
          );
          return;
        }

        openCalendarConnect([booking]);
      }}
    >
      <CalendarDays size={19} />
      Add to calendar
    </button>

    <span>
      Deadline alerts · 7, 3 and 1 day before
    </span>
  </div>
)}
                        <div className="card-footer">
                          <span
                            className={`badge ${
                              bookingStatus === 'Expiring soon'
                                ? 'amber'
                                : bookingStatus === 'Free cancellation'
                                  ? 'green'
                                  : 'neutral'
                            }`}
                          >
                            <span />{bookingStatus}
                          </span>

                          {deadline && (
                            <span className="deadline">
                              <Clock3 size={14} />
                              {deadline.kind === 'Payment due' ? 'Payment · ' : ''}
                              {countdown(deadline.at, now)}
                            </span>
                          )}
                        </div>

                        {overlapping.length > 0 && booking.state === 'active' && (
                          <div className="overlap">
                            Overlaps with {overlapping.map(item => item.name).join(', ')}
                          </div>
                        )}

                        {booking.state === 'active' && booking.total === 0 && (
                          <div className="overlap">Total cost not entered</div>
                        )}

                        {booking.state === 'active' &&
                          booking.paid < booking.total &&
                          !booking.paymentAt && (
                            <div className="overlap">
                              Add a payment deadline to include it in your calendar export.
                            </div>
                          )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="right-column">
              <section className="next-card">
                <div className="next-label"><span /> ON THE HORIZON</div>
                <h2>
                  {deadlines.length ? 'Your next deadline' : 'Room to breathe.'}
                </h2>

                {deadlines.length ? (
                  <>
                    <div className="next-count">
                      {countdown(deadlines[0].deadline!.at, now)}
                    </div>
                    <h3>{deadlines[0].booking.name}</h3>
                    <p>
                      {deadlines[0].deadline!.kind}
                      <br />
                      {when(
                        deadlines[0].deadline!.at,
                        deadlines[0].booking.offset,
                      )}
                    </p>
                    <button onClick={() => setEditing(deadlines[0].booking)}>
                      Review booking <ArrowUpRight size={17} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="horizon-art"><div /><Plane size={25} /></div>
                    <p>
                      No upcoming deadlines yet.
                      <br />
                      They’ll appear here as you add bookings.
                    </p>
                  </>
                )}
              </section>

              <section className="checklist">
                <h3>A good trip starts organised.</h3>

                <div>
                  <span>01</span>
                  <p>
                    Add your reservations
                    <small>Stay dates, costs and booking links.</small>
                  </p>
                </div>

                <div>
                  <span>02</span>
                  <p>
                    Check the fine print
                    <small>Record exact cancellation and payment deadlines.</small>
                  </p>
                </div>

                <div>
                  <span>03</span>
                  <p>
                    Keep dates in your calendar
                    <small>Request alerts 7 days, 3 days and 1 day before.</small>
                  </p>
                </div>

                <button onClick={exportCalendar}>
                  Add to calendar <ArrowUpRight size={15} />
                </button>
              </section>

              <div className="gmail-note">
                <CalendarDays size={19} />
                <p>
                  Calendar reminders
                  <small>
                    Add exported events to your calendar and check their alerts.
                    Changes in Allthatbook won’t update existing calendar events.
                  </small>
                </p>
              </div>
            </aside>
          </div>

          <footer>
            <span className="footer-brand">Allthatbook.</span>
            <span>A little less to keep in your head.</span>
            <span>
              <ShieldCheck size={13} />
              {demo
                ? 'Example workspace'
                : signedIn
                  ? 'Your workspace is private'
                  : 'Saved in this browser'}
            </span>
          </footer>
        </main>
      </div>

      {importing && (
        <ImportModal
          onClose={() => setImporting(false)}
          onResult={applyImport}
        />
      )}

      {editing && (
        <BookingForm
          key={editing.id}
          warnings={
            imported && imported.id === editing.id ? imported.warnings : []
          }
          missing={
            imported && imported.id === editing.id ? imported.missing : []
          }
          initial={editing}
          saving={saving}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => setDeleteId(editing.id)}
          exists={data.some(booking => booking.id === editing.id)}
        />
      )}

      {deleteId && (
        <div className="modal-overlay confirm-overlay">
          <section
            className="confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-heading"
          >
            <h2 id="delete-heading">Delete this booking?</h2>
            <p>
              This removes it from Allthatbook. It does not cancel your reservation
              or remove previously exported calendar events.
            </p>
            <div className="form-actions">
              <button
                className="secondary"
                disabled={saving}
                onClick={() => setDeleteId(null)}
              >
                Keep booking
              </button>
              <button className="danger" disabled={saving} onClick={remove}>
                {saving ? 'Deleting…' : 'Delete booking'}
              </button>
            </div>
          </section>
        </div>
      )}

      {info && (
        <div className="modal-overlay">
          <section
            className="confirm"
            role="dialog"
            aria-modal="true"
            aria-label="About your workspace"
            style={{ maxHeight: '90dvh', overflowY: 'auto' }}
          >
            <button
              className="close"
              onClick={() => setInfo(false)}
              aria-label="Close"
            >
              <X />
            </button>

            <h2>Your Allthatbook workspace</h2>

            <p>
              {signedIn
                ? 'Bookings are saved to your signed-in account.'
                : 'Bookings are saved in this browser only. Sign in to keep them across devices.'}
            </p>

            <p>
              Export your deadlines to your calendar for reminders 7 days,
              3 days and 1 day before free cancellation ends or payment is due.
              Reminder times that have already passed are skipped.
            </p>

            <p>
              Add the downloaded events to your calendar and check their alerts.
              Calendar apps may handle imported reminders differently.
              Enable your calendar notifications to receive alerts.
            </p>

            <p>
              Calendar events do not automatically sync with Allthatbook.
              If you change, pay for or cancel a booking, update or remove
              its calendar events too. Repeated imports may create duplicates.
            </p>

            <p>
              Check recorded deadlines against your booking confirmation.
              Marking a booking cancelled here does not cancel your reservation.
              Cancel through your booking provider.
            </p>

            <button className="primary" onClick={() => setInfo(false)}>
              Got it
            </button>
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="Dismiss" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

type BookingFormProps = {
  warnings?: string[];
  missing?: string[];
  initial: Booking;
  saving: boolean;
  onClose: () => void;
  onSave: (booking: Booking) => void;
  onDelete: () => void;
  exists: boolean;
};

function BookingForm({
  initial,
  saving,
  onClose,
  onSave,
  onDelete,
  exists,
  warnings = [],
  missing = [],
}: BookingFormProps) {
  const [booking, setBooking] = useState(initial);
  const [validation, setValidation] = useState('');

  function set<K extends keyof Booking>(key: K, value: Booking[K]) {
    setBooking(old => ({ ...old, [key]: value }));
  }

  const offsets = [
    '-12:00', '-11:00', '-10:00', '-09:00', '-08:00', '-07:00',
    '-06:00', '-05:00', '-04:00', '-03:30', '-03:00', '-02:00',
    '-01:00', '+00:00', '+01:00', '+02:00', '+03:00', '+03:30',
    '+04:00', '+04:30', '+05:00', '+05:30', '+05:45', '+06:00',
    '+06:30', '+07:00', '+08:00', '+09:00', '+09:30', '+10:00',
    '+10:30', '+11:00', '+12:00', '+12:45', '+13:00', '+13:45',
    '+14:00',
  ];

  return (
    <div className="modal-overlay">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="form-title"
      >
        <div className="modal-header">
          <div>
            <div className="eyebrow">YOUR TRAVEL PLANS</div>
            <h2 id="form-title">
              {exists ? 'Booking details' : 'Add a booking'}
            </h2>
          </div>

          <button
            className="icon-button"
            disabled={saving}
            onClick={onClose}
            aria-label="Close booking form"
          >
            <X />
          </button>
        </div>

        <form
          onSubmit={event => {
            event.preventDefault();
            const parsed = bookingSchema.safeParse(booking);

            if (!parsed.success) {
              setValidation(parsed.error.issues[0].message);
              return;
            }

            setValidation('');
            onSave(parsed.data);
          }}
        >
          <div className="form-body">
            {missing.length > 0 && (
              <div
                role="alert"
                style={{
                  background: '#fdecea',
                  border: '2px solid #d93025',
                  borderRadius: 12,
                  padding: '14px 16px',
                  marginBottom: 16,
                  color: '#5f1410',
                }}
              >
                <strong style={{ fontSize: 16 }}>
                  Details not found during import
                </strong>
                <ul
                  style={{
                    margin: '8px 0',
                    paddingLeft: 20,
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {missing.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
                <p style={{ margin: 0, fontSize: 14 }}>
                  Check your booking confirmation and fill these in below.
                  This list records what was missing at import.
                </p>
              </div>
            )}

            {warnings.length > 0 && (
              <div
                role="note"
                style={{
                  background: '#fff7e0',
                  border: '1px solid #f0d58a',
                  borderRadius: 12,
                  padding: '10px 14px',
                  marginBottom: 16,
                  fontSize: 14,
                  color: '#4a3b00',
                }}
              >
                <strong>Check these before saving</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {warnings.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
              </div>
            )}

            <div className="form-grid">
              <label className="full">
                Property or reservation name
                <input
                  autoFocus
                  required
                  maxLength={160}
                  value={booking.name}
                  onChange={event => set('name', event.target.value)}
                  placeholder="e.g. Hotel in Kichijoji"
                />
              </label>

              <label>
                Destination
                <input
                  required
                  maxLength={120}
                  value={booking.destination}
                  onChange={event => set('destination', event.target.value)}
                  placeholder="Tokyo, Japan"
                />
              </label>

              <label>
                Trip
                <input
                  maxLength={100}
                  value={booking.trip}
                  onChange={event => set('trip', event.target.value)}
                  placeholder="Japan getaway"
                />
              </label>

              <label>
                Booking platform
                <select
                  value={booking.platform}
                  onChange={event =>
                    set('platform', event.target.value as Booking['platform'])
                  }
                >
                  {['Agoda', 'Airbnb', 'Booking.com', 'Direct', 'Other']
                    .map(value => <option key={value}>{value}</option>)}
                </select>
              </label>

              <label>
                Booking reference
                <input
                  maxLength={100}
                  value={booking.reference}
                  onChange={event => set('reference', event.target.value)}
                />
              </label>

              <label>
                Check-in
                <input
                  type="date"
                  required
                  value={booking.checkIn}
                  onChange={event => set('checkIn', event.target.value)}
                />
              </label>

              <label>
                Check-out
                <input
                  type="date"
                  required
                  min={booking.checkIn}
                  value={booking.checkOut}
                  onChange={event => set('checkOut', event.target.value)}
                />
              </label>
            </div>

            <h3>Costs &amp; payments</h3>

            <div className="form-grid thirds">
              <label>
                Currency
                <select
                  value={booking.currency}
                  onChange={event =>
                    set('currency', event.target.value as Booking['currency'])
                  }
                >
                  {[
                    'SGD', 'JPY', 'USD', 'EUR', 'GBP', 'AUD',
                    'MYR', 'THB', 'CNY', 'KRW', 'HKD',
                  ].map(value => <option key={value}>{value}</option>)}
                </select>
              </label>

              <label>
                Total cost
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1000000000"
                  required
                  value={booking.total}
                  onChange={event => set('total', Number(event.target.value))}
                />
              </label>

              <label>
                Amount paid
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={booking.total}
                  required
                  value={booking.paid}
                  onChange={event => set('paid', Number(event.target.value))}
                />
              </label>
            </div>

            <div className="quick-actions">
              <button
                type="button"
                onClick={() => set('paid', booking.total)}
              >
                <Check size={14} /> Mark fully paid
              </button>
            </div>

            <h3>Deadlines</h3>

            <div className="form-grid">
              <label className="full">
                Deadline timezone (UTC offset)
                <select
                  value={booking.offset}
                  onChange={event => {
                    const offset = event.target.value;

                    setBooking(old => ({
                      ...old,
                      offset,
                      cancellationAt: old.cancellationAt
                        ? `${localTime(old.cancellationAt, old.offset)}:00${offset}`
                        : null,
                      paymentAt: old.paymentAt
                        ? `${localTime(old.paymentAt, old.offset)}:00${offset}`
                        : null,
                    }));
                  }}
                >
                  {offsets.map(offset => (
                    <option key={offset} value={offset}>
                      UTC{offset}
                      {offset === '+09:00'
                        ? ' · Japan / Korea'
                        : offset === '+08:00'
                          ? ' · Singapore / China'
                          : offset === '+00:00'
                            ? ' · UTC'
                            : ''}
                    </option>
                  ))}
                </select>
                <small>
                  Use the offset stated in your booking, including daylight
                  saving at the deadline.
                </small>
              </label>

              <label className="full">
                Cancellation policy
                <select
                  value={booking.policy}
                  onChange={event => {
                    const policy = event.target.value as Booking['policy'];

                    setBooking(old => ({
                      ...old,
                      policy,
                      cancellationAt:
                        policy === 'free' ? old.cancellationAt : null,
                    }));
                  }}
                >
                  <option value="free">
                    Free cancellation until a deadline
                  </option>
                  <option value="nonrefundable">Non-refundable</option>
                  <option value="unknown">Needs verification</option>
                </select>
              </label>

              {booking.policy === 'free' && (
                <label className="full">
                  Free-cancellation deadline
                  <input
                    type="datetime-local"
                    required
                    value={localTime(booking.cancellationAt, booking.offset)}
                    onChange={event =>
                      set(
                        'cancellationAt',
                        event.target.value
                          ? `${event.target.value}:00${booking.offset}`
                          : null,
                      )
                    }
                  />
                </label>
              )}

              <label>
                Cancellation charge
                <input
                  type="number"
                  min="0"
                  max={booking.total}
                  step="0.01"
                  placeholder="Unknown"
                  value={booking.fee ?? ''}
                  onChange={event =>
                    set(
                      'fee',
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
                <small>
                  {booking.policy === 'free'
                    ? 'Charge after the free period. '
                    : 'Current cancellation charge. '}
                  Leave blank if unverified.
                </small>
              </label>

              <label>
                Payment deadline
                <input
                  type="datetime-local"
                  value={localTime(booking.paymentAt, booking.offset)}
                  onChange={event =>
                    set(
                      'paymentAt',
                      event.target.value
                        ? `${event.target.value}:00${booking.offset}`
                        : null,
                    )
                  }
                />
                <small>
                  Use the payment due date or scheduled charge date
                  from your booking.
                </small>
              </label>
            </div>

            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              After saving, use Add to calendar to export deadline reminders.
              Saving a booking alone does not enable notifications.
            </p>

            <h3>Reservation details</h3>

            <div className="form-grid">
              <label className="full">
                Booking management link
                <input
                  type="url"
                  maxLength={2000}
                  value={booking.url}
                  onChange={event => set('url', event.target.value)}
                  placeholder="https://…"
                />
                {booking.url && /^https?:\/\//i.test(booking.url) && (
                  <a
                    className="provider-link"
                    href={booking.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open reservation <ExternalLink size={13} />
                  </a>
                )}
              </label>

              <label className="full">
                Notes &amp; cancellation conditions
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={booking.notes}
                  onChange={event => set('notes', event.target.value)}
                  placeholder="e.g. One night's charge after the deadline"
                />
              </label>

              <label className="full">
                Booking status
                <select
                  value={booking.state}
                  onChange={event =>
                    set('state', event.target.value as Booking['state'])
                  }
                >
                  <option value="active">Active</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="completed">Completed</option>
                </select>
                <small>
                  Changing status here does not cancel the reservation
                  or update existing calendar events.
                </small>
              </label>
            </div>

            {validation && (
              <p className="validation" role="alert">{validation}</p>
            )}
          </div>

          <div className="form-actions">
            {exists && (
              <button
                type="button"
                className="delete-button"
                disabled={saving}
                onClick={onDelete}
              >
                Delete booking
              </button>
            )}
            <div className="spacer" />
            <button
              className="secondary"
              type="button"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save booking'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}