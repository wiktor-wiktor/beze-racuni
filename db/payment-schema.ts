export const paymentSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS payable_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_key TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL,
    type_id INTEGER REFERENCES bill_types(id),
    month TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    invoice_number TEXT NOT NULL DEFAULT '',
    issued_on TEXT NOT NULL DEFAULT '',
    due_on TEXT NOT NULL DEFAULT '',
    transaction_title TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL DEFAULT '',
    iban TEXT NOT NULL,
    receiver_name TEXT NOT NULL,
    street TEXT NOT NULL,
    postal_code TEXT NOT NULL,
    city TEXT NOT NULL,
    invoice_id INTEGER UNIQUE REFERENCES invoices(id) ON DELETE SET NULL,
    paid_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payable_invoice_number_idx
   ON payable_invoices(profile_id, invoice_number) WHERE invoice_number <> ''`,
];
