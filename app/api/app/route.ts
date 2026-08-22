import { ensureSchema } from "@/db";
import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

const ADMIN_COOKIE = "bezenskova-house-admin";
const DEVELOPMENT_ADMIN_PASSWORD = "rachunki123#";
const BILL_ICONS = new Set([
  "↯",
  "≈",
  "◒",
  "⌁",
  "◆",
  "●",
  "☀",
  "♨",
  "⌂",
  "✦",
  "♻",
  "◉",
]);

type D1Row = Record<string, unknown>;

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function previousMonth() {
  const [year, month] = currentMonth().split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function readId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function readAmount(value: unknown) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 && cents <= 100_000_000 ? cents : null;
}

function readMonth(value: unknown) {
  const month = String(value ?? "");
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : null;
}

function readName(value: unknown, label = "Name") {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!name) throw new Error(`${label} is required.`);
  if (name.length > 80) throw new Error(`${label} must be 80 characters or fewer.`);
  return name;
}

function readIcon(value: unknown) {
  const icon = String(value ?? "");
  return BILL_ICONS.has(icon) ? icon : null;
}

function adminPassword() {
  const configured = env.ADMIN_PASSWORD;
  return typeof configured === "string" && configured.length > 0
    ? configured
    : DEVELOPMENT_ADMIN_PASSWORD;
}

async function adminToken() {
  const bytes = new TextEncoder().encode(
    `bezenskova-house-admin:${adminPassword()}`,
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function isAdmin() {
  return (await cookies()).get(ADMIN_COOKIE)?.value === (await adminToken());
}

function rows<T = D1Row>(result: D1Result<T>) {
  return (result.results ?? []) as T[];
}

async function requireAdmin() {
  if (!(await isAdmin())) throw new Error("UNAUTHORIZED");
}

async function finalizeMonth(db: D1Database, month: string) {
  const existing = await db
    .prepare("SELECT id FROM month_summaries WHERE month = ?")
    .bind(month)
    .first<{ id: number }>();
  if (existing) return;

  const typeCount = await db
    .prepare("SELECT COUNT(*) AS count FROM bill_types WHERE active = 1")
    .first<{ count: number }>();
  const invoiceCount = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM invoices i
       JOIN bill_types bt ON bt.id = i.type_id
       WHERE i.month = ? AND bt.active = 1`,
    )
    .bind(month)
    .first<{ count: number }>();

  if (!typeCount?.count || invoiceCount?.count !== typeCount.count) return;

  const total = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM invoices WHERE month = ?")
    .bind(month)
    .first<{ total: number }>();
  const inserted = await db
    .prepare(
      "INSERT INTO month_summaries (month, total_cents) VALUES (?, ?) RETURNING id",
    )
    .bind(month, total?.total ?? 0)
    .first<{ id: number }>();

  if (!inserted) return;
  await db
    .prepare(
      `INSERT INTO month_summary_items
        (summary_id, recipient_id, recipient_name, amount_cents)
       SELECT ?, s.recipient_id, MAX(s.recipient_name), SUM(s.amount_cents)
       FROM invoice_shares s
       JOIN invoices i ON i.id = s.invoice_id
       WHERE i.month = ?
       GROUP BY recipient_id`,
    )
    .bind(inserted.id, month)
    .run();
}

async function publicState(db: D1Database) {
  const [typeResult, invoiceResult, invoiceShareResult, summaryResult, summaryItemResult] =
    await db.batch([
      db.prepare("SELECT id, name, icon FROM bill_types WHERE active = 1 ORDER BY id"),
      db.prepare(
        `SELECT id, month, type_id AS typeId, type_name AS typeName,
                type_icon AS typeIcon, amount_cents AS amountCents,
                created_at AS createdAt
         FROM invoices ORDER BY created_at DESC, id DESC`,
      ),
      db.prepare(
        `SELECT invoice_id AS invoiceId, recipient_id AS recipientId,
                recipient_name AS recipientName, weight,
                amount_cents AS amountCents
         FROM invoice_shares
         ORDER BY amount_cents DESC, recipient_name`,
      ),
      db.prepare(
        `SELECT id, month, total_cents AS totalCents, created_at AS createdAt
         FROM month_summaries ORDER BY created_at DESC, id DESC`,
      ),
      db.prepare(
        `SELECT summary_id AS summaryId, recipient_id AS recipientId,
                recipient_name AS recipientName, amount_cents AS amountCents
         FROM month_summary_items
         ORDER BY amount_cents DESC, recipient_name`,
      ),
    ]);

  const types = rows<{ id: number; name: string; icon: string }>(typeResult);
  const shares = rows<{
    invoiceId: number;
    recipientId: number;
    recipientName: string;
    weight: number;
    amountCents: number;
  }>(invoiceShareResult);
  const summaryItems = rows<{
    summaryId: number;
    recipientId: number;
    recipientName: string;
    amountCents: number;
  }>(summaryItemResult);

  const invoices = rows<{
    id: number;
    month: string;
    typeId: number;
    typeName: string;
    typeIcon: string;
    amountCents: number;
    createdAt: string;
  }>(invoiceResult).map((invoice) => ({
    ...invoice,
    monthLabel: monthLabel(invoice.month),
    shares: shares.filter((share) => share.invoiceId === invoice.id),
  }));

  const summaries = rows<{
    id: number;
    month: string;
    totalCents: number;
    createdAt: string;
  }>(summaryResult).map((summary) => ({
    ...summary,
    monthLabel: monthLabel(summary.month),
    items: summaryItems.filter((item) => item.summaryId === summary.id),
  }));

  function monthState(month: string) {
    const monthInvoices = invoices.filter((invoice) => invoice.month === month);
    const summary = summaries.find((item) => item.month === month);
    const runningTotals = new Map<
      number,
      { recipientId: number; recipientName: string; amountCents: number }
    >();
    for (const invoice of monthInvoices) {
      for (const share of invoice.shares) {
        const prior = runningTotals.get(share.recipientId);
        runningTotals.set(share.recipientId, {
          recipientId: share.recipientId,
          recipientName: share.recipientName,
          amountCents: (prior?.amountCents ?? 0) + share.amountCents,
        });
      }
    }

    const receivedCount = monthInvoices.filter((invoice) =>
      types.some((type) => type.id === invoice.typeId),
    ).length;

    return {
      month,
      monthLabel: monthLabel(month),
      totalCents: monthInvoices.reduce(
        (sum, invoice) => sum + invoice.amountCents,
        0,
      ),
      receivedCount,
      typeCount: summary ? receivedCount : types.length,
      complete: Boolean(summary),
      totals:
        summary?.items ??
        [...runningTotals.values()].sort(
          (a, b) => b.amountCents - a.amountCents,
        ),
      receivedTypeIds: monthInvoices.map((invoice) => invoice.typeId),
    };
  }

  return {
    types,
    invoices,
    summaries,
    current: monthState(currentMonth()),
    featured: monthState(previousMonth()),
  };
}

async function adminState(db: D1Database) {
  const [recipientResult, shareResult] = await db.batch([
    db.prepare(
      "SELECT id, name, created_at AS createdAt FROM recipients WHERE active = 1 ORDER BY name",
    ),
    db.prepare(
      `SELECT recipient_id AS recipientId, type_id AS typeId, weight
       FROM recipient_type_shares`,
    ),
  ]);
  const shareRows = rows<{ recipientId: number; typeId: number; weight: number }>(
    shareResult,
  );
  return {
    recipients: rows<{ id: number; name: string; createdAt: string }>(
      recipientResult,
    ).map((recipient) => ({
      ...recipient,
      shares: Object.fromEntries(
        shareRows
          .filter((share) => share.recipientId === recipient.id)
          .map((share) => [share.typeId, share.weight]),
      ),
    })),
  };
}

export async function GET() {
  try {
    const db = await ensureSchema();
    const publicData = await publicState(db);
    return Response.json({
      ...publicData,
      admin: (await isAdmin()) ? await adminState(db) : null,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to load bills.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const action = String(payload.action ?? "");

    if (action === "login") {
      if (payload.password !== adminPassword()) {
        return jsonError("That password is not correct.", 401);
      }
      const cookieStore = await cookies();
      cookieStore.set(ADMIN_COOKIE, await adminToken(), {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
      const db = await ensureSchema();
      return Response.json({
        ok: true,
        ...(await publicState(db)),
        admin: await adminState(db),
      });
    }

    if (action === "logout") {
      (await cookies()).delete(ADMIN_COOKIE);
      return Response.json({ ok: true });
    }

    await requireAdmin();
    const db = await ensureSchema();

    if (action === "addType") {
      const name = readName(payload.name, "Bill type");
      const icon = readIcon(payload.icon);
      if (!icon) return jsonError("Choose a valid bill type icon.");
      const match = await db
        .prepare("SELECT id, active FROM bill_types WHERE LOWER(name) = LOWER(?)")
        .bind(name)
        .first<{ id: number; active: number }>();
      if (match?.active) return jsonError("That bill type already exists.", 409);
      if (match) {
        await db
          .prepare(
            "UPDATE bill_types SET active = 1, name = ?, icon = ? WHERE id = ?",
          )
          .bind(name, icon, match.id)
          .run();
      } else {
        await db
          .prepare("INSERT INTO bill_types (name, icon) VALUES (?, ?)")
          .bind(name, icon)
          .run();
      }
    } else if (action === "updateTypeIcon") {
      const id = readId(payload.id);
      const icon = readIcon(payload.icon);
      if (!id || !icon) return jsonError("Choose a valid bill type and icon.");
      await db
        .prepare("UPDATE bill_types SET icon = ? WHERE id = ? AND active = 1")
        .bind(icon, id)
        .run();
    } else if (action === "deleteType") {
      const id = readId(payload.id);
      if (!id) return jsonError("Choose a valid bill type.");
      const count = await db
        .prepare("SELECT COUNT(*) AS count FROM bill_types WHERE active = 1")
        .first<{ count: number }>();
      if ((count?.count ?? 0) <= 1) return jsonError("Keep at least one bill type.");
      await db.batch([
        db.prepare("UPDATE bill_types SET active = 0 WHERE id = ?").bind(id),
        db.prepare("DELETE FROM recipient_type_shares WHERE type_id = ?").bind(id),
      ]);
    } else if (action === "addRecipient" || action === "updateRecipient") {
      const name = readName(payload.name, "Recipient name");
      const requestedShares =
        payload.shares && typeof payload.shares === "object"
          ? (payload.shares as Record<string, unknown>)
          : {};
      const activeTypes = rows<{ id: number }>(
        await db.prepare("SELECT id FROM bill_types WHERE active = 1").all(),
      );
      const parsedShares = activeTypes.map((type) => {
        const weight = Number(requestedShares[type.id] ?? 0);
        if (!Number.isInteger(weight) || weight < 0 || weight > 1000) {
          throw new Error("Shares must be whole numbers from 0 to 1000.");
        }
        return { typeId: type.id, weight };
      });
      if (!parsedShares.some((share) => share.weight > 0)) {
        return jsonError("Give this person a share in at least one bill type.");
      }

      let recipientId: number;
      if (action === "addRecipient") {
        const inserted = await db
          .prepare("INSERT INTO recipients (name) VALUES (?) RETURNING id")
          .bind(name)
          .first<{ id: number }>();
        if (!inserted) throw new Error("Could not add the recipient.");
        recipientId = inserted.id;
      } else {
        const id = readId(payload.id);
        if (!id) return jsonError("Choose a valid recipient.");
        recipientId = id;
        await db
          .prepare("UPDATE recipients SET name = ? WHERE id = ? AND active = 1")
          .bind(name, id)
          .run();
        await db
          .prepare("DELETE FROM recipient_type_shares WHERE recipient_id = ?")
          .bind(id)
          .run();
      }

      const positiveShares = parsedShares.filter((share) => share.weight > 0);
      if (positiveShares.length) {
        await db.batch(
          positiveShares.map((share) =>
            db
              .prepare(
                "INSERT INTO recipient_type_shares (recipient_id, type_id, weight) VALUES (?, ?, ?)",
              )
              .bind(recipientId, share.typeId, share.weight),
          ),
        );
      }
    } else if (action === "deleteRecipient") {
      const id = readId(payload.id);
      if (!id) return jsonError("Choose a valid recipient.");
      await db.batch([
        db.prepare("UPDATE recipients SET active = 0 WHERE id = ?").bind(id),
        db.prepare("DELETE FROM recipient_type_shares WHERE recipient_id = ?").bind(id),
      ]);
    } else if (action === "addInvoice") {
      const typeId = readId(payload.typeId);
      const month = readMonth(payload.month);
      const amountCents = readAmount(payload.amount);
      if (!typeId || !month || !amountCents) {
        return jsonError("Choose a month, bill type, and valid positive amount.");
      }
      const type = await db
        .prepare(
          "SELECT id, name, icon FROM bill_types WHERE id = ? AND active = 1",
        )
        .bind(typeId)
        .first<{ id: number; name: string; icon: string }>();
      if (!type) return jsonError("That bill type is no longer active.");
      const closedMonth = await db
        .prepare("SELECT id FROM month_summaries WHERE month = ?")
        .bind(month)
        .first<{ id: number }>();
      if (closedMonth) {
        return jsonError(
          `${monthLabel(month)} is already complete. Its final split is locked.`,
          409,
        );
      }

      const configured = rows<{
        recipientId: number;
        recipientName: string;
        weight: number;
      }>(
        await db
          .prepare(
            `SELECT r.id AS recipientId, r.name AS recipientName, s.weight
             FROM recipient_type_shares s
             JOIN recipients r ON r.id = s.recipient_id
             WHERE s.type_id = ? AND s.weight > 0 AND r.active = 1
             ORDER BY r.id`,
          )
          .bind(typeId)
          .all(),
      );
      if (!configured.length) {
        return jsonError(`Add at least one recipient share for ${type.name} first.`);
      }

      const totalWeight = configured.reduce((sum, item) => sum + item.weight, 0);
      const allocations = configured.map((item) => {
        const raw = amountCents * item.weight;
        return {
          ...item,
          amountCents: Math.floor(raw / totalWeight),
          remainder: raw % totalWeight,
        };
      });
      let centsLeft =
        amountCents - allocations.reduce((sum, item) => sum + item.amountCents, 0);
      allocations
        .sort((a, b) => b.remainder - a.remainder || a.recipientId - b.recipientId)
        .forEach((item) => {
          if (centsLeft > 0) {
            item.amountCents += 1;
            centsLeft -= 1;
          }
        });

      let invoice: { id: number };
      try {
        const inserted = await db
          .prepare(
            `INSERT INTO invoices
              (month, type_id, type_name, type_icon, amount_cents)
             VALUES (?, ?, ?, ?, ?) RETURNING id`,
          )
          .bind(month, typeId, type.name, type.icon, amountCents)
          .first<{ id: number }>();
        if (!inserted) throw new Error("Could not add the invoice.");
        invoice = inserted;
      } catch (error) {
        if (String(error).includes("UNIQUE")) {
          return jsonError(`${type.name} already has an invoice for ${monthLabel(month)}.`, 409);
        }
        throw error;
      }

      await db.batch(
        allocations.map((item) =>
          db
            .prepare(
              `INSERT INTO invoice_shares
                (invoice_id, recipient_id, recipient_name, weight, amount_cents)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              invoice.id,
              item.recipientId,
              item.recipientName,
              item.weight,
              item.amountCents,
            ),
        ),
      );
      await finalizeMonth(db, month);
    } else if (action === "deleteInvoice") {
      const id = readId(payload.id);
      if (!id) return jsonError("Choose a valid invoice.");
      const invoice = await db
        .prepare("SELECT month FROM invoices WHERE id = ?")
        .bind(id)
        .first<{ month: string }>();
      if (!invoice) return jsonError("That invoice no longer exists.", 404);
      const summary = await db
        .prepare("SELECT id FROM month_summaries WHERE month = ?")
        .bind(invoice.month)
        .first<{ id: number }>();
      const statements = [
        ...(summary
          ? [
              db.prepare("DELETE FROM month_summary_items WHERE summary_id = ?").bind(summary.id),
              db.prepare("DELETE FROM month_summaries WHERE id = ?").bind(summary.id),
            ]
          : []),
        db.prepare("DELETE FROM invoice_shares WHERE invoice_id = ?").bind(id),
        db.prepare("DELETE FROM invoices WHERE id = ?").bind(id),
      ];
      await db.batch(statements);
      await finalizeMonth(db, invoice.month);
    } else {
      return jsonError("Unknown action.", 404);
    }

    const publicData = await publicState(db);
    return Response.json({ ok: true, ...publicData, admin: await adminState(db) });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonError("Your admin session has expired.", 401);
    }
    return jsonError(
      error instanceof Error ? error.message : "Something went wrong.",
      500,
    );
  }
}
