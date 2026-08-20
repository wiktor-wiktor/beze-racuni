import { sql } from "drizzle-orm";
import {
  integer,
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
