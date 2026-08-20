import { env } from "cloudflare:workers";

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS bill_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT NOT NULL DEFAULT '•',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS recipient_type_shares (
    recipient_id INTEGER NOT NULL,
    type_id INTEGER NOT NULL,
    weight INTEGER NOT NULL,
    PRIMARY KEY (recipient_id, type_id),
    FOREIGN KEY (recipient_id) REFERENCES recipients(id),
    FOREIGN KEY (type_id) REFERENCES bill_types(id)
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL,
    type_id INTEGER NOT NULL,
    type_name TEXT NOT NULL,
    type_icon TEXT NOT NULL DEFAULT '•',
    amount_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (month, type_id),
    FOREIGN KEY (type_id) REFERENCES bill_types(id)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_shares (
    invoice_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    recipient_name TEXT NOT NULL,
    weight INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    PRIMARY KEY (invoice_id, recipient_id),
    FOREIGN KEY (invoice_id) REFERENCES invoices(id)
  )`,
  `CREATE TABLE IF NOT EXISTS month_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month TEXT NOT NULL UNIQUE,
    total_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS month_summary_items (
    summary_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    recipient_name TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    PRIMARY KEY (summary_id, recipient_id),
    FOREIGN KEY (summary_id) REFERENCES month_summaries(id)
  )`,
];

let initialized = false;

export function getD1() {
  if (!env.DB) {
    throw new Error("The local bills database is unavailable.");
  }
  return env.DB;
}

export async function ensureSchema() {
  if (initialized) return getD1();

  const db = getD1();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));

  const billTypeColumns = (await db
    .prepare("PRAGMA table_info(bill_types)")
    .all<{ name: string }>()).results ?? [];
  if (!billTypeColumns.some((column) => column.name === "icon")) {
    await db
      .prepare("ALTER TABLE bill_types ADD COLUMN icon TEXT NOT NULL DEFAULT '•'")
      .run();
  }

  const invoiceColumns = (await db
    .prepare("PRAGMA table_info(invoices)")
    .all<{ name: string }>()).results ?? [];
  if (!invoiceColumns.some((column) => column.name === "type_icon")) {
    await db
      .prepare("ALTER TABLE invoices ADD COLUMN type_icon TEXT NOT NULL DEFAULT '•'")
      .run();
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO bill_types (name, icon) VALUES
        ('Electricity', '↯'), ('Water', '≈'), ('Gas', '◒'), ('Internet', '⌁')`,
    )
    .run();
  await db
    .prepare(
      `UPDATE bill_types
       SET icon = CASE name
         WHEN 'Electricity' THEN '↯'
         WHEN 'Water' THEN '≈'
         WHEN 'Gas' THEN '◒'
         WHEN 'Internet' THEN '⌁'
         ELSE icon
       END
       WHERE icon = '•'`,
    )
    .run();
  await db
    .prepare("UPDATE bill_types SET icon = '♻' WHERE LOWER(name) = 'trash' AND icon <> '♻'")
    .run();
  await db
    .prepare(
      `UPDATE invoices
       SET type_icon = COALESCE(
         (SELECT icon FROM bill_types WHERE bill_types.id = invoices.type_id),
         '•'
       )
       WHERE type_icon = '•'`,
    )
    .run();
  await db
    .prepare("UPDATE invoices SET type_icon = '♻' WHERE LOWER(type_name) = 'trash' AND type_icon <> '♻'")
    .run();
  initialized = true;
  return db;
}
