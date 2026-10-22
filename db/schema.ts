import { sql } from "drizzle-orm";
import {
  integer,
  blob,
  index,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const billTypes = sqliteTable(
  "bill_types",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    icon: text("icon").notNull().default("•"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("bill_types_name_idx").on(table.name)],
);

export const recipients = sqliteTable("recipients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const recipientTypeShares = sqliteTable(
  "recipient_type_shares",
  {
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => recipients.id),
    typeId: integer("type_id")
      .notNull()
      .references(() => billTypes.id),
    weight: integer("weight").notNull(),
  },
  (table) => [primaryKey({ columns: [table.recipientId, table.typeId] })],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    typeId: integer("type_id")
      .notNull()
      .references(() => billTypes.id),
    typeName: text("type_name").notNull(),
    typeIcon: text("type_icon").notNull().default("•"),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("invoices_month_type_idx").on(table.month, table.typeId),
  ],
);

export const invoiceShares = sqliteTable(
  "invoice_shares",
  {
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => invoices.id),
    recipientId: integer("recipient_id").notNull(),
    recipientName: text("recipient_name").notNull(),
    weight: integer("weight").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.invoiceId, table.recipientId] }),
  ],
);

export const monthSummaries = sqliteTable(
  "month_summaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    month: text("month").notNull(),
    totalCents: integer("total_cents").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("month_summaries_month_idx").on(table.month)],
);

export const monthSummaryItems = sqliteTable(
  "month_summary_items",
  {
    summaryId: integer("summary_id")
      .notNull()
      .references(() => monthSummaries.id),
    recipientId: integer("recipient_id").notNull(),
    recipientName: text("recipient_name").notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.summaryId, table.recipientId] }),
  ],
);

export const payableInvoices = sqliteTable(
  "payable_invoices",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    importKey: text("import_key").notNull().unique(),
    profileId: text("profile_id").notNull(),
    typeId: integer("type_id").references(() => billTypes.id),
    month: text("month").notNull(),
    amountCents: integer("amount_cents").notNull(),
    invoiceNumber: text("invoice_number").notNull().default(""),
    issuedOn: text("issued_on").notNull().default(""),
    dueOn: text("due_on").notNull().default(""),
    transactionTitle: text("transaction_title").notNull().default(""),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sourceName: text("source_name").notNull().default(""),
    iban: text("iban").notNull(),
    receiverName: text("receiver_name").notNull(),
    street: text("street").notNull(),
    postalCode: text("postal_code").notNull(),
    city: text("city").notNull(),
    invoiceId: integer("invoice_id").unique().references(() => invoices.id, { onDelete: "set null" }),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("payable_invoice_number_idx")
    .on(table.profileId, table.invoiceNumber).where(sql`${table.invoiceNumber} <> ''`)],
);

// Original photo bytes are chunked so this schema works in both SQLite and D1.
export const invoicePhotos = sqliteTable("invoice_photos", {
  id: text("id").primaryKey(),
  payableId: integer("payable_id").notNull().references(() => payableInvoices.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  mediaType: text("media_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("invoice_photos_payable_idx").on(table.payableId)]);

export const invoicePhotoChunks = sqliteTable("invoice_photo_chunks", {
  photoId: text("photo_id").notNull().references(() => invoicePhotos.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  data: blob("data", { mode: "buffer" }).notNull(),
}, (table) => [primaryKey({ columns: [table.photoId, table.sequence] })]);
