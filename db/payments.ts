import { paymentProfiles } from "./payment-profiles";
import type { Payable } from "@/lib/payments";
import { photoState } from "./invoice-photos";

export class PaymentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const selectPayable = `SELECT p.id, p.import_key AS importKey, p.profile_id AS profileId,
  p.type_id AS typeId, bt.name AS typeName, p.month, p.amount_cents AS amountCents,
  p.invoice_number AS invoiceNumber, p.issued_on AS issuedOn, p.due_on AS dueOn,
  p.transaction_title AS transactionTitle, p.reference, p.notes, p.source_name AS sourceName,
  p.iban, p.receiver_name AS receiverName, p.street, p.postal_code AS postalCode, p.city,
  p.invoice_id AS invoiceId, p.paid_at AS paidAt, p.created_at AS createdAt
  FROM payable_invoices p LEFT JOIN bill_types bt ON bt.id = p.type_id`;

export async function paymentState(db: D1Database) {
  const result = await db.prepare(`${selectPayable}
    ORDER BY p.paid_at IS NOT NULL, CASE WHEN p.paid_at IS NULL THEN NULLIF(p.due_on, '') END IS NULL,
    CASE WHEN p.paid_at IS NULL THEN p.due_on END, p.paid_at DESC, p.id DESC`).all<Payable>();
  const photos = await photoState(db);
  return { paymentProfiles, payables: (result.results ?? []).map((payable) => ({
    ...payable, photos: photos.filter((photo) => photo.payableId === payable.id)
      .map(({ id, name, mediaType, byteSize }) => ({ id, name, mediaType, byteSize })),
  })) };
}

export async function getPayable(db: D1Database, value: unknown) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new PaymentError("Choose a valid payment entry.");
  const payable = await db.prepare(`${selectPayable} WHERE p.id = ?`).bind(id).first<Payable>();
  if (!payable) throw new PaymentError("That payment entry no longer exists.", 404);
  return payable;
}

function field(value: unknown, name: string, max = 200) {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > max) {
    throw new PaymentError(`${name} must be text of at most ${max} characters.`);
  }
  return value.trim();
}

function dateField(value: unknown, name: string) {
  const date = field(value, name, 10);
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
    throw new PaymentError(`${name} must be a valid date (YYYY-MM-DD).`);
  }
  return date;
}

export async function savePayable(db: D1Database, payload: Record<string, unknown>, update: boolean) {
  const existing = update ? await getPayable(db, payload.id) : null;
  if (existing?.paidAt) throw new PaymentError("Mark this entry unpaid before editing it.", 409);
  const profile = paymentProfiles.find((item) => item.id === payload.profileId);
  if (!profile) throw new PaymentError("Choose a payment profile from the supplied directory.");
  const importKey = existing?.importKey ?? field(payload.importKey, "Import key", 160);
  if (!importKey) throw new PaymentError("A stable import key is required to prevent duplicate imports.");
  const month = field(payload.month, "Month", 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new PaymentError("Choose a valid billing month.");
  const amount = String(payload.amount ?? "").trim().replace(",", ".");
  const amountCents = Math.round(Number(amount) * 100);
  if (!/^\d+(\.\d{1,2})?$/.test(amount) || amountCents <= 0 || amountCents > 100_000_000) {
    throw new PaymentError("Enter a positive EUR amount with at most two decimal places.");
  }
  const typeId = payload.typeId == null || payload.typeId === "" ? null : Number(payload.typeId);
  if (typeId !== null && (!Number.isInteger(typeId) || typeId <= 0 || !(await db
    .prepare("SELECT id FROM bill_types WHERE id = ? AND active = 1").bind(typeId).first()))) {
    throw new PaymentError("Choose an active app service, or leave it unmatched for review.");
  }
  if (existing?.invoiceId && (existing.typeId !== typeId || existing.month !== month || existing.amountCents !== amountCents)) {
    throw new PaymentError("This invoice is published. Remove it from Manage invoices before changing its service, month, or amount.", 409);
  }
  const invoiceNumber = field(payload.invoiceNumber, "Invoice number", 100);
  const issuedOn = dateField(payload.issuedOn, "Issue date");
  const dueOn = dateField(payload.dueOn, "Due date");
  const transactionTitle = field(payload.transactionTitle, "Transaction title", 140);
  const reference = field(payload.reference, "Payment reference", 100);
  const notes = field(payload.notes, "Review notes", 2000);
  const sourceName = field(payload.sourceName, "Source filename", 255);
  if (!update) {
    const duplicate = await db.prepare(`SELECT id, import_key AS importKey FROM payable_invoices
      WHERE import_key = ? OR (profile_id = ? AND invoice_number = ? AND invoice_number <> '')`)
      .bind(importKey, profile.id, invoiceNumber).first<{ id: number; importKey: string }>();
    if (duplicate) return { importedId: duplicate.id, duplicate: true };
  }
  // Preserve the saved directory snapshot on ordinary edits, even if the directory later changes.
  const receiver = existing?.profileId === profile.id ? existing : profile;
  const values = [profile.id, typeId, month, amountCents, invoiceNumber, issuedOn, dueOn,
    transactionTitle, reference, notes, sourceName, receiver.iban, receiver.receiverName,
    receiver.street, receiver.postalCode, receiver.city];
  try {
    if (existing) {
      await db.prepare(`UPDATE payable_invoices SET profile_id = ?, type_id = ?, month = ?,
        amount_cents = ?, invoice_number = ?, issued_on = ?, due_on = ?, transaction_title = ?,
        reference = ?, notes = ?, source_name = ?, iban = ?, receiver_name = ?, street = ?,
        postal_code = ?, city = ? WHERE id = ? AND paid_at IS NULL`)
        .bind(...values, existing.id).run();
      return { importedId: existing.id };
    }
    const inserted = await db.prepare(`INSERT INTO payable_invoices
      (profile_id, type_id, month, amount_cents, invoice_number, issued_on, due_on,
       transaction_title, reference, notes, source_name, iban, receiver_name, street, postal_code, city, import_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(...values, importKey).first<{ id: number }>();
    return { importedId: inserted!.id, duplicate: false };
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new PaymentError("This invoice has already been imported. Refresh the inbox.", 409);
    throw error;
  }
}

export async function changePayable(db: D1Database, action: string, payload: Record<string, unknown>) {
  const payable = await getPayable(db, payload.id);
  if (action === "deletePayable") {
    if (payable.invoiceId || payable.paidAt) throw new PaymentError("Only unpaid, unpublished drafts can be deleted.", 409);
    await db.prepare("DELETE FROM payable_invoices WHERE id = ? AND invoice_id IS NULL AND paid_at IS NULL").bind(payable.id).run();
  } else {
    if (typeof payload.paid !== "boolean") throw new PaymentError("Choose paid or unpaid.");
    await db.prepare(`UPDATE payable_invoices SET paid_at = ${payload.paid ? "COALESCE(paid_at, CURRENT_TIMESTAMP)" : "NULL"} WHERE id = ?`)
      .bind(payable.id).run();
  }
}
