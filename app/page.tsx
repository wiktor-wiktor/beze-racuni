"use client";

import {
  type CSSProperties,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type BillType = { id: number; name: string; icon: string };
type Split = {
  recipientId: number;
  recipientName: string;
  amountCents: number;
  weight?: number;
};
type Invoice = {
  id: number;
  month: string;
  monthLabel: string;
  typeId: number;
  typeName: string;
  typeIcon: string;
  amountCents: number;
  createdAt: string;
  shares: Split[];
};
type Summary = {
  id: number;
  month: string;
  monthLabel: string;
  totalCents: number;
  createdAt: string;
  items: Split[];
};
type Recipient = {
  id: number;
  name: string;
  shares: Record<string, number>;
};
type MonthStatus = {
  month: string;
  monthLabel: string;
  totalCents: number;
  receivedCount: number;
  typeCount: number;
  complete: boolean;
  totals: Split[];
  receivedTypeIds: number[];
};
type AppData = {
  types: BillType[];
  invoices: Invoice[];
  summaries: Summary[];
  current: MonthStatus;
  featured: MonthStatus;
  admin: null | { recipients: Recipient[] };
};

const BILL_ICONS = ["↯", "≈", "◒", "⌁", "◆", "●", "☀", "♨", "⌂", "✦", "♻", "◉"];

const currency = new Intl.NumberFormat("en", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function money(cents: number) {
  return currency.format(cents / 100);
}

function monthName(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function api(payload?: Record<string, unknown>) {
  const response = await fetch("/api/app", {
    method: payload ? "POST" : "GET",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data as AppData;
}

export default function Home() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<"feed" | "admin">("feed");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api());
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Unable to load." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "Unable to load.",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function mutate(payload: Record<string, unknown>, success?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const next = await api(payload);
      if (payload.action === "logout") {
        await refresh();
      } else {
        setData(next);
      }
      if (success) setNotice({ kind: "success", text: success });
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
      if (error instanceof Error && error.message.includes("expired")) await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-mark">BH</div>
        <p>Opening the household ledger…</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="loading-screen">
        <div className="loading-mark">!</div>
        <h1>The ledger could not be opened.</h1>
        <button className="button primary" onClick={refresh}>Try again</button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => setView("feed")} aria-label="Bezenškova House home">
          <span className="brand-mark">BH</span>
          <span>
            <strong>Bezenškova House</strong>
            <small>Our shared bills</small>
          </span>
        </button>
        <nav className="view-switcher" aria-label="Main navigation">
          <button
            className={view === "feed" ? "active" : ""}
            onClick={() => setView("feed")}
          >
            Household feed
          </button>
          <button
            className={view === "admin" ? "active" : ""}
            onClick={() => setView("admin")}
          >
            Admin
          </button>
        </nav>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss message">×</button>
        </div>
      )}

      {view === "feed" ? (
        <Feed data={data} />
      ) : (
        <Admin
          data={data}
          busy={busy}
          mutate={mutate}
        />
      )}

      <footer>
        <span>Bezenškova House</span>
        <span>Clear numbers, calmer home.</span>
      </footer>
    </div>
  );
}

function Feed({ data }: { data: AppData }) {
  const monthGroups = useMemo(() => {
    type FeedPost =
      | { kind: "invoice"; date: string; item: Invoice }
      | { kind: "summary"; date: string; item: Summary };

    const groups = new Map<string, { monthLabel: string; posts: FeedPost[] }>();
    const addPost = (month: string, monthLabel: string, post: FeedPost) => {
      if (month > data.featured.month) return;

      const group = groups.get(month) ?? { monthLabel, posts: [] };
      group.posts.push(post);
      groups.set(month, group);
    };

    data.invoices.forEach((invoice) =>
      addPost(invoice.month, invoice.monthLabel, {
        kind: "invoice",
        date: invoice.createdAt,
        item: invoice,
      }),
    );
    data.summaries.forEach((summary) =>
      addPost(summary.month, summary.monthLabel, {
        kind: "summary",
        date: summary.createdAt,
        item: summary,
      }),
    );

    return [...groups.entries()]
      .sort(([monthA], [monthB]) => monthB.localeCompare(monthA))
      .map(([month, group]) => ({
        month,
        monthLabel: group.monthLabel,
        posts: group.posts.sort(
          (a, b) =>
            Number(b.kind === "summary") - Number(a.kind === "summary") ||
            b.date.localeCompare(a.date),
        ),
      }));
  }, [data.featured.month, data.invoices, data.summaries]);
  const remaining = Math.max(
    0,
    data.featured.typeCount - data.featured.receivedCount,
  );

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{data.featured.monthLabel}</p>
          <div className="month-progress" aria-label={`${data.featured.receivedCount} of ${data.featured.typeCount} bills received`}>
            <div className="progress-line">
              <span style={{ width: `${data.featured.typeCount ? (data.featured.receivedCount / data.featured.typeCount) * 100 : 0}%` }} />
            </div>
            <div>
              <strong>{data.featured.complete ? "Month complete" : `${remaining} bill${remaining === 1 ? "" : "s"} still to come`}</strong>
              <span>{data.featured.receivedCount} of {data.featured.typeCount} received</span>
            </div>
          </div>
        </div>

        <aside className="month-card">
          <div className="month-card-top">
            <span>Last month ({monthName(data.featured.month)})</span>
            <span className={`status-pill ${data.featured.complete ? "complete" : ""}`}>
              {data.featured.complete ? "Complete" : "In progress"}
            </span>
          </div>
          <strong className="grand-total">{money(data.featured.totalCents)}</strong>
          <p className="muted">Total household cost</p>
          <div className="current-people">
            {data.featured.totals.length ? data.featured.totals.map((person) => (
              <div className="person-total" key={person.recipientId}>
                <span className="avatar">{initials(person.recipientName)}</span>
                <span>{person.recipientName}</span>
                <strong>{money(person.amountCents)}</strong>
              </div>
            )) : (
              <p className="empty-inline">Individual totals will appear with the first bill.</p>
            )}
          </div>
        </aside>
      </section>

      <section className="feed-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Household activity</p>
            <h2>The bill feed</h2>
          </div>
          <div className="type-key" aria-label="Current bill types">
            {data.types.map((type) => (
              <span key={type.id}>
                <i>{type.icon}</i>{type.name}
              </span>
            ))}
          </div>
        </div>

        {monthGroups.length === 0 ? (
          <div className="empty-feed">
            <span className="empty-symbol">⌁</span>
            <h3>The feed is ready.</h3>
            <p>When the first invoice is added, everyone will see it here with the exact split.</p>
          </div>
        ) : (
          <div className="feed-list">
            {monthGroups.map((group, index) => (
              <section
                className="feed-month"
                data-tone={index % 3}
                key={group.month}
                aria-labelledby={`feed-month-${group.month}`}
              >
                <div className="feed-month-heading">
                  <h3 id={`feed-month-${group.month}`}>
                    {group.monthLabel}{group.month === data.featured.month ? " (current)" : ""}
                  </h3>
                  <span>{group.posts.length} {group.posts.length === 1 ? "entry" : "entries"}</span>
                </div>
                <div className="feed-month-posts">
                  {group.posts.map((post) =>
                    post.kind === "invoice" ? (
                      <InvoicePost invoice={post.item} key={`invoice-${post.item.id}`} />
                    ) : (
                      <SummaryPost summary={post.item} key={`summary-${post.item.id}`} />
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function InvoicePost({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="feed-card invoice-card">
      <div className="feed-icon">{invoice.typeIcon}</div>
      <div className="feed-card-body">
        <button
          className="feed-card-heading invoice-toggle"
          type="button"
          aria-expanded={open}
          aria-controls={`invoice-details-${invoice.id}`}
          onClick={() => setOpen((current) => !current)}
        >
          <div>
            <p className="post-label">Invoice received · {invoice.monthLabel}</p>
            <h3>{invoice.typeName}</h3>
          </div>
          <span className="invoice-toggle-end">
            <strong className="post-amount">{money(invoice.amountCents)}</strong>
            <span className={`chevron ${open ? "open" : ""}`} aria-hidden="true">⌄</span>
          </span>
        </button>
        {open && (
          <div className="split-list" id={`invoice-details-${invoice.id}`}>
            {invoice.shares.map((share) => (
              <div className="split-row" key={share.recipientId}>
                <span className="avatar small">{initials(share.recipientName)}</span>
                <span className="split-name">{share.recipientName}</span>
                <strong>{money(share.amountCents)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function SummaryPost({ summary }: { summary: Summary }) {
  return (
    <article className="feed-card summary-card">
      <div className="feed-card-body">
        <div className="summary-heading">
          <h3>Everything is in.</h3>
          <strong className="post-amount">{money(summary.totalCents)}</strong>
        </div>
        <div className="summary-people">
          {summary.items.map((item) => (
            <div key={item.recipientId}>
              <span className="avatar light">{initials(item.recipientName)}</span>
              <span>{item.recipientName}</span>
              <strong>{money(item.amountCents)}</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function Admin({
  data,
  busy,
  mutate,
}: {
  data: AppData;
  busy: boolean;
  mutate: (payload: Record<string, unknown>, success?: string) => Promise<boolean>;
}) {
  if (!data.admin) return <AdminLogin busy={busy} mutate={mutate} />;
  return <AdminPanel data={data} busy={busy} mutate={mutate} />;
}

function AdminLogin({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>, success?: string) => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutate({ action: "login", password });
  }
  return (
    <main className="admin-login-wrap">
      <section className="admin-login">
        <div className="lock-mark">BH</div>
        <p className="eyebrow">Private household tools</p>
        <h1>Welcome back.</h1>
        <p>Enter the shared admin password to add bills and manage how they are divided.</p>
        <form onSubmit={submit}>
          <label>
            Admin password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              autoFocus
              required
            />
          </label>
          <button className="button primary wide" disabled={busy}>
            {busy ? "Opening…" : "Open admin"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AdminPanel({
  data,
  busy,
  mutate,
}: {
  data: AppData;
  busy: boolean;
  mutate: (payload: Record<string, unknown>, success?: string) => Promise<boolean>;
}) {
  const [invoiceMonth, setInvoiceMonth] = useState(data.current.month);
  const [invoiceType, setInvoiceType] = useState(String(data.types[0]?.id ?? ""));
  const [invoiceAmount, setInvoiceAmount] = useState("");
  const [typeName, setTypeName] = useState("");
  const [typeIcon, setTypeIcon] = useState("◆");
  const [recipientName, setRecipientName] = useState("");
  const [recipientShares, setRecipientShares] = useState<Record<string, number>>({});
  const selectedInvoiceType = data.types.some(
    (type) => String(type.id) === invoiceType,
  )
    ? invoiceType
    : String(data.types[0]?.id ?? "");

  async function addInvoice(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate(
      {
        action: "addInvoice",
        month: invoiceMonth,
        typeId: Number(selectedInvoiceType),
        amount: invoiceAmount,
      },
      "Invoice added to the household feed.",
    );
    if (ok) setInvoiceAmount("");
  }

  async function addType(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate(
      { action: "addType", name: typeName, icon: typeIcon },
      "Bill type added.",
    );
    if (ok) {
      setTypeName("");
      setTypeIcon("◆");
    }
  }

  async function addRecipient(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate(
      { action: "addRecipient", name: recipientName, shares: recipientShares },
      "Recipient added.",
    );
    if (ok) {
      setRecipientName("");
      setRecipientShares({});
    }
  }

  const missingTypes = data.types.filter(
    (type) => !data.current.receivedTypeIds.includes(type.id),
  );

  return (
    <main className="admin-main">
      <div className="admin-title">
        <div>
          <p className="eyebrow">Household controls</p>
          <h1>Keep the numbers moving.</h1>
          <p>Add this month’s invoices, adjust future shares, and keep the feed tidy.</p>
        </div>
        <button className="button ghost" disabled={busy} onClick={() => mutate({ action: "logout" })}>
          Lock admin
        </button>
      </div>

      <section className="admin-grid">
        <div className="admin-card accent-card">
          <div className="card-title">
            <span className="step">01</span>
            <div>
              <p className="eyebrow">New activity</p>
              <h2>Add an invoice</h2>
            </div>
          </div>
          <form className="invoice-form" onSubmit={addInvoice}>
            <label>
              Month
              <input type="month" value={invoiceMonth} onChange={(event) => setInvoiceMonth(event.target.value)} required />
            </label>
            <label>
              Bill type
              <select value={selectedInvoiceType} onChange={(event) => setInvoiceType(event.target.value)} required>
                {data.types.map((type) => (
                  <option value={type.id} key={type.id}>{type.icon} {type.name}</option>
                ))}
              </select>
            </label>
            <label className="amount-field">
              Amount
              <span>
                <input
                  inputMode="decimal"
                  value={invoiceAmount}
                  onChange={(event) => setInvoiceAmount(event.target.value)}
                  placeholder="0.00"
                  required
                />
                <i>EUR</i>
              </span>
            </label>
            <button className="button dark" disabled={busy || !data.types.length}>
              {busy ? "Saving…" : "Publish invoice"}
            </button>
          </form>
          <div className="missing-strip">
            <span>{data.current.monthLabel}</span>
            {data.current.complete ? (
              <strong>All bills are in</strong>
            ) : (
              <p>Still waiting for: <strong>{missingTypes.map((type) => type.name).join(", ") || "none"}</strong></p>
            )}
          </div>
        </div>

        <div className="admin-card">
          <div className="card-title">
            <span className="step">02</span>
            <div>
              <p className="eyebrow">Configuration</p>
              <h2>Bill types</h2>
            </div>
          </div>
          <div className="type-admin-list">
            {data.types.map((type) => (
              <div key={type.id}>
                <IconPicker
                  value={type.icon}
                  label={`Icon for ${type.name}`}
                  disabled={busy}
                  onChange={(icon) =>
                    mutate(
                      { action: "updateTypeIcon", id: type.id, icon },
                      `${type.name} icon updated.`,
                    )
                  }
                />
                <span>{type.name}</span>
                <button
                  className="type-remove"
                  aria-label={`Remove ${type.name}`}
                  disabled={busy}
                  onClick={() => mutate({ action: "deleteType", id: type.id }, `${type.name} removed from future months.`)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <form className="inline-form" onSubmit={addType}>
            <IconPicker
              value={typeIcon}
              label="Icon for new bill type"
              disabled={busy}
              onChange={setTypeIcon}
            />
            <label className="sr-only" htmlFor="new-type">New bill type</label>
            <input id="new-type" value={typeName} onChange={(event) => setTypeName(event.target.value)} placeholder="Add another type" required />
            <button className="button secondary" disabled={busy}>Add</button>
          </form>
        </div>
      </section>

      <section className="admin-card recipients-card">
        <div className="card-title spread">
          <div className="title-with-step">
            <span className="step">03</span>
            <div>
              <p className="eyebrow">Who shares what</p>
              <h2>Recipients & weights</h2>
            </div>
          </div>
          <p className="helper">0 means this person does not share that bill. Relative weights split the total proportionally.</p>
        </div>

        <form
          className="recipient-row new-recipient"
          onSubmit={addRecipient}
          style={{ "--type-count": data.types.length } as CSSProperties}
        >
          <label className="name-cell">
            <span>New recipient</span>
            <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Full name" required />
          </label>
          {data.types.map((type) => (
            <WeightInput
              key={type.id}
              label={type.name}
              value={recipientShares[type.id] ?? 0}
              onChange={(value) => setRecipientShares((current) => ({ ...current, [type.id]: value }))}
            />
          ))}
          <button className="button dark" disabled={busy}>Add person</button>
        </form>

        <div className="recipient-list">
          {data.admin!.recipients.length ? data.admin!.recipients.map((recipient) => (
            <RecipientEditor
              key={recipient.id}
              recipient={recipient}
              types={data.types}
              busy={busy}
              mutate={mutate}
            />
          )) : (
            <div className="admin-empty">Add the first person above, then assign their weights for each bill type.</div>
          )}
        </div>
      </section>

      <section className="admin-card invoices-admin">
        <div className="card-title">
          <span className="step">04</span>
          <div>
            <p className="eyebrow">Published feed entries</p>
            <h2>Manage invoices</h2>
          </div>
        </div>
        {data.invoices.length ? (
          <div className="invoice-table">
            {data.invoices.map((invoice) => (
              <div key={invoice.id}>
                <span className="type-icon">{invoice.typeIcon}</span>
                <span>
                  <strong>{invoice.typeName}</strong>
                  <small>{invoice.monthLabel}</small>
                </span>
                <strong>{money(invoice.amountCents)}</strong>
                <button
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => mutate({ action: "deleteInvoice", id: invoice.id }, "Invoice removed.")}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-empty">No invoices have been published yet.</div>
        )}
      </section>
    </main>
  );
}

function IconPicker({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (icon: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="icon-picker">
      <button
        className="icon-picker-trigger"
        type="button"
        aria-label={label}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        {value}
      </button>
      {open && (
        <div className="icon-picker-menu" role="group" aria-label={label}>
          {BILL_ICONS.map((icon) => (
            <button
              className={icon === value ? "selected" : ""}
              type="button"
              aria-label={`Use ${icon} icon`}
              key={icon}
              onClick={() => {
                onChange(icon);
                setOpen(false);
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WeightInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="weight-cell">
      <span>{label}</span>
      <input
        type="number"
        min="0"
        max="1000"
        step="1"
        value={value}
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        aria-label={`${label} weight`}
      />
    </label>
  );
}

function RecipientEditor({
  recipient,
  types,
  busy,
  mutate,
}: {
  recipient: Recipient;
  types: BillType[];
  busy: boolean;
  mutate: (payload: Record<string, unknown>, success?: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(recipient.name);
  const [shares, setShares] = useState<Record<string, number>>(recipient.shares);

  return (
    <form
      className="recipient-row"
      style={{ "--type-count": types.length } as CSSProperties}
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "updateRecipient", id: recipient.id, name, shares }, `${name}'s future shares were updated.`);
      }}
    >
      <label className="name-cell">
        <span>Recipient</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      {types.map((type) => (
        <WeightInput
          key={type.id}
          label={type.name}
          value={shares[type.id] ?? 0}
          onChange={(value) => setShares((current) => ({ ...current, [type.id]: value }))}
        />
      ))}
      <div className="row-actions">
        <button className="button secondary" disabled={busy}>Save</button>
        <button
          className="text-button danger"
          type="button"
          disabled={busy}
          onClick={() => mutate({ action: "deleteRecipient", id: recipient.id }, `${recipient.name} removed from future bills.`)}
        >
          Remove
        </button>
      </div>
    </form>
  );
}
