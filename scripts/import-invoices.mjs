#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [argument] = process.argv.slice(2);
if (!argument || argument === "--help") {
  console.log(`Usage: node scripts/import-invoices.mjs --list | invoice-data.json
Set BH_APP_URL to the running app's URL and BH_ADMIN_PASSWORD to its admin password.
--list shows active services, the payment directory, inbox and ledger history, and completed months.
JSON may contain one draft or an array.
Imports create unpaid drafts only. Reusing an importKey returns the existing entry.`);
  process.exit(0);
}
const base = process.env.BH_APP_URL;
const password = process.env.BH_ADMIN_PASSWORD;
if (!base || !password) {
  console.error("Set BH_APP_URL and BH_ADMIN_PASSWORD. The target must be explicit to avoid importing into the wrong database.");
  process.exit(1);
}
const endpoint = new URL("/api/app", base);
let cookie;
async function api(payload) {
  const response = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  const nextCookie = response.headers.getSetCookie().find((value) => value.startsWith("bezenskova-house-admin="));
  if (nextCookie) cookie = nextCookie.split(";")[0];
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}
try {
  const state = await api({ action: "login", password });
  if (argument === "--list") {
    console.log(JSON.stringify({ types: state.types, paymentProfiles: state.admin.paymentProfiles,
      publishedInvoices: state.invoices.map(({ id, month, typeId, typeName }) =>
        ({ id, month, typeId, typeName })),
      completedMonths: state.summaries.map(({ month }) => month),
      existingInvoices: state.admin.payables.map(({ id, importKey, profileId, invoiceNumber, month, typeId, paidAt }) =>
        ({ id, importKey, profileId, invoiceNumber, month, typeId, paidAt })) }, null, 2));
  } else {
    const parsed = JSON.parse(await readFile(argument, "utf8"));
    const drafts = Array.isArray(parsed) ? parsed : [parsed];
    if (!drafts.length || drafts.some((item) => !item || typeof item !== "object" || Array.isArray(item) || !item.importKey)) {
      throw new Error("Provide one draft or an array of drafts, each with a stable importKey.");
    }
    for (const [index, draft] of drafts.entries()) {
      const result = await api({ ...draft, action: "importPayable" });
      console.log(JSON.stringify({ item: index + 1, id: result.importedId,
        status: result.duplicate ? "already imported; existing entry unchanged" : "saved as unpaid draft" }));
    }
  }
} catch (error) {
  console.error(error.message);
  console.error("If a batch stopped partway through, retry the same file: previously imported entries are retained and skipped.");
  process.exitCode = 1;
}
