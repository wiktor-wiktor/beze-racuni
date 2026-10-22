"use client";

import { useState, type FormEvent } from "react";
import type { Payable, PaymentAdminData, PaymentProfile } from "@/lib/payments";

type BillType = { id: number; name: string; icon: string };
type Mutate = (payload: Record<string, unknown>, success?: string) => Promise<boolean>;
const money = (cents: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100);
const displayDate = (date: string) => date ? date.slice(0, 10).split("-").reverse().join(".") : "Not provided";

async function copyText(value: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // The app also runs on plain HTTP on the household LAN.
  const previous = document.activeElement as HTMLElement | null;
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Select and copy the value manually.");
  } finally {
    input.remove();
    previous?.focus();
  }
}

function CopyField({ label, value, copyValue, onCopy }: {
  label: string; value: string; copyValue?: string;
  onCopy: (value: string, label: string) => void;
}) {
  return <button type="button" className="transfer-field" disabled={!value}
    aria-label={value ? `Copy ${label}: ${value}` : `${label}: not provided`}
    onClick={() => onCopy(copyValue ?? value, label)}>
    <span>{label}<span aria-hidden="true">{value ? "↗ Copy" : "Missing"}</span></span>
    <strong>{value || "Not provided"}</strong>
  </button>;
}

function PaymentForm({ payable, profiles, types, busy, mutate, onClose, month }: {
  payable?: Payable; profiles: PaymentProfile[]; types: BillType[];
  busy: boolean; mutate: Mutate; onClose: () => void; month: string;
}) {
  const [profileId, setProfileId] = useState(payable?.profileId ?? profiles[0]?.id ?? "");
  const profile = profiles.find((item) => item.id === profileId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const ok = await mutate({ ...fields,
      action: payable ? "updatePayable" : "importPayable",
      ...(payable ? { id: payable.id } : { importKey: `manual:${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}` }),
    }, payable ? "Invoice details saved." : "Invoice saved to the unpaid inbox.");
    if (ok) onClose();
  }
  return <form className="payment-edit-form" onSubmit={submit}>
    <label>Invoice type / payment profile<select name="profileId" value={profileId} onChange={(event) => setProfileId(event.target.value)} required>
      {profiles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    <label>App service<select name="typeId" defaultValue={payable?.typeId ?? ""}>
      <option value="">Unmatched — review needed</option>
      {types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <p className="profile-preview">{profile?.receiverName} · {profile?.iban}<br />{profile?.street}, {profile?.postalCode} {profile?.city}</p>
    <label>Billing month<input name="month" type="month" defaultValue={payable?.month ?? month} required /></label>
    <label>Amount (EUR)<input name="amount" inputMode="decimal" placeholder="0,00" defaultValue={payable ? (payable.amountCents / 100).toFixed(2) : ""} required /></label>
    <label>Invoice number<input name="invoiceNumber" maxLength={100} defaultValue={payable?.invoiceNumber} /></label>
    <label>Payment reference / sklic<input name="reference" maxLength={100} defaultValue={payable?.reference} placeholder="Copy exactly from the invoice" /></label>
    <label>Issue date<input name="issuedOn" type="date" defaultValue={payable?.issuedOn} /></label>
    <label>Due date<input name="dueOn" type="date" defaultValue={payable?.dueOn} /></label>
    <label className="full-width">Transaction title / namen<input name="transactionTitle" maxLength={140} defaultValue={payable?.transactionTitle} /></label>
    <label className="full-width">Source filename<input name="sourceName" maxLength={255} defaultValue={payable?.sourceName} /></label>
    <label className="full-width">Review notes<textarea name="notes" maxLength={2000} rows={3} defaultValue={payable?.notes} placeholder="Unclear text, account discrepancies, or details to check" /></label>
    <div className="payment-actions full-width">
      <button className="button dark" disabled={busy}>{busy ? "Saving…" : "Save invoice"}</button>
      <button type="button" className="button ghost" onClick={onClose} disabled={busy}>Cancel</button>
    </div>
  </form>;
}

function PaymentCard({ payable: p, profiles, types, busy, mutate }: {
  payable: Payable; profiles: PaymentProfile[]; types: BillType[]; busy: boolean; mutate: Mutate;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"pay" | "undo" | "delete" | null>(null);
  const [copyNotice, setCopyNotice] = useState("");
  const address = [p.street, [p.postalCode, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const profile = profiles.find((item) => item.id === p.profileId);
  const activeType = types.find((item) => item.id === p.typeId);
  const overdue = !p.paidAt && p.dueOn && p.dueOn < new Date().toLocaleDateString("en-CA");
  const missing = [!p.reference && "payment reference", !p.transactionTitle && "transaction title", !p.dueOn && "due date"].filter(Boolean);
  async function copy(value: string, label: string) {
    try { await copyText(value); setCopyNotice(`${label} copied.`); }
    catch { setCopyNotice("Copy unavailable. Select the field’s text and copy manually."); }
  }
  async function confirm(action = confirmAction) {
    const ok = await mutate(action === "delete" ? { action: "deletePayable", id: p.id } :
      { action: "setPayablePaid", id: p.id, paid: action === "pay" },
      action === "pay" ? "Marked paid and published to the household feed." :
        action === "undo" ? "Returned to unpaid and removed from the household feed." : "Draft deleted.");
    if (ok) setConfirmAction(null);
  }
  return <article className={`payment-entry${p.paidAt ? " payment-entry-paid" : ""}`}>
    <div className="payment-entry-heading">
      <div><p className="eyebrow">{profile?.label} · {p.month}</p><h3>{p.receiverName}</h3>
        <p className="payment-meta">{p.typeName || "Unmatched service"} · Invoice {p.invoiceNumber || "number not provided"}</p></div>
      <div className="payment-total"><strong>{money(p.amountCents)}</strong>
        <span className={overdue ? "overdue" : ""}>{p.paidAt ? `Paid ${displayDate(p.paidAt)}` : `${overdue ? "Overdue" : "Due"} ${displayDate(p.dueOn)}`}</span></div>
    </div>
    {editing ? <PaymentForm payable={p} profiles={profiles} types={types} busy={busy} mutate={mutate} onClose={() => setEditing(false)} month={p.month} /> : <>
      {!p.paidAt && (!activeType || missing.length > 0 || p.notes) && <div className="payment-review">
        {!activeType && <p>Choose an active app service before marking paid.</p>}
        {missing.length > 0 && <p>Check before transfer: {missing.join(", ")} not provided.</p>}
        {p.notes && <p>{p.notes}</p>}
      </div>}
      <div className="transfer-grid">
        <CopyField label="Account number / IBAN" value={p.iban} copyValue={p.iban.replace(/\s/g, "")} onCopy={copy} />
        <CopyField label="Amount (EUR)" value={(p.amountCents / 100).toFixed(2).replace(".", ",")} onCopy={copy} />
        <CopyField label="Receiver name" value={p.receiverName} onCopy={copy} />
        <CopyField label="Full address" value={address} onCopy={copy} />
        <CopyField label="Transaction title / namen" value={p.transactionTitle}
          copyValue={p.transactionTitle.normalize("NFD").replace(/\p{M}/gu, "")} onCopy={copy} />
        <CopyField label="Payment reference / sklic" value={p.reference} onCopy={copy} />
      </div>
      <div className="payment-copy-footer"><button className="text-button" type="button"
        onClick={() => copy(`${p.receiverName}\n${p.street}\n${p.postalCode} ${p.city}`, "Name and address")}>Copy name & full address</button>
        <span role="status" aria-live="polite">{copyNotice}</span></div>
      <p className="payment-meta">Issued {displayDate(p.issuedOn)}{p.sourceName ? ` · Source: ${p.sourceName}` : ""}</p>
      {p.paidAt && p.notes && <p className="payment-meta">{p.notes}</p>}
      {confirmAction ? <div className="payment-confirm">
        <p>{confirmAction === "pay" ? "Have you completed the bank transfer? Confirming marks this invoice paid and publishes the household split." :
          confirmAction === "undo" ? "Return this invoice to unpaid? This removes it from the household feed and recalculates the month’s totals." : "Delete this unpaid draft?"}</p>
        <div className="payment-actions"><button className="button dark" disabled={busy} onClick={() => confirm()}>{busy ? "Saving…" : "Confirm"}</button>
          <button className="button ghost" disabled={busy} onClick={() => setConfirmAction(null)}>Cancel</button></div>
      </div> : <div className="payment-actions">
        {p.paidAt ? <button className="button ghost" disabled={busy} onClick={() => setConfirmAction("undo")}>Mark unpaid</button> : <>
          <button className="button dark" disabled={busy || !activeType} onClick={() => confirm("pay")}>Mark as paid</button>
          <button className="button ghost" disabled={busy} onClick={() => setEditing(true)}>Edit details</button>
          <button className="text-button danger" disabled={busy} onClick={() => setConfirmAction("delete")}>Delete draft</button>
        </>}
      </div>}
    </>}
  </article>;
}

export default function PaymentInbox({ data, types, busy, mutate, month }: {
  data: PaymentAdminData; types: BillType[]; busy: boolean; mutate: Mutate; month: string;
}) {
  const [adding, setAdding] = useState(false);
  const unpaid = data.payables.filter((item) => !item.paidAt);
  const paid = data.payables.filter((item) => item.paidAt);
  return <section className="admin-card payment-inbox">
    <div className="card-title spread"><div><p className="eyebrow">Supplier payments</p><h2>Invoices to pay <span className="payment-count">{unpaid.length}</span></h2>
      <p className="payment-intro">Click any transfer field to copy it. Mark paid after your bank transfer to publish the household split.</p></div>
      <button className="button secondary" disabled={busy} onClick={() => setAdding(!adding)}>{adding ? "Close form" : "Add to inbox"}</button></div>
    <details className="import-help"><summary>Import from a Codex task</summary><p>Attach invoice pictures to a task in this project and ask it to import them into the invoice inbox. The project’s invoice-import guide explains how to match services and save drafts. Refresh this page after importing.</p></details>
    {adding && <PaymentForm profiles={data.paymentProfiles} types={types} busy={busy} mutate={mutate} onClose={() => setAdding(false)} month={month} />}
    {unpaid.length > 0 && <div className="unpaid-total">Awaiting payment <strong>{money(unpaid.reduce((sum, item) => sum + item.amountCents, 0))}</strong></div>}
    <div className="payment-list">{unpaid.map((item) => <PaymentCard key={item.id} payable={item} profiles={data.paymentProfiles} types={types} busy={busy} mutate={mutate} />)}</div>
    {!unpaid.length && <div className="admin-empty compact">No invoices waiting for payment.</div>}
    <details className="paid-history"><summary>Paid history <span>{paid.length}</span></summary>
      <div className="payment-list">{paid.map((item) => <PaymentCard key={item.id} payable={item} profiles={data.paymentProfiles} types={types} busy={busy} mutate={mutate} />)}</div>
      {!paid.length && <p className="payment-meta">Paid invoices will stay here for your records.</p>}
    </details>
  </section>;
}
