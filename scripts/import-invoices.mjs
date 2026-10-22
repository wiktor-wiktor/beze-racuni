#!/usr/bin/env node
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const [argument, ...flags] = process.argv.slice(2);
const dataOnly = flags.includes("--data-only");
if (!argument || argument === "--help") {
  console.log(`Usage: node scripts/import-invoices.mjs --list | invoice-data.json [--data-only]
Set BH_APP_URL to the running app's URL and BH_ADMIN_PASSWORD to its admin password.
--list shows active services, the payment directory, inbox and ledger history, and completed months.
JSON may contain one draft or an array. Include sourceFiles: ["photo.jpg", ...] in each draft.
Paths are relative to the JSON file. JPEG, PNG, WebP; up to 10 MB each and 20 per invoice.
Imports create unpaid drafts and archive original photos. Retries add missing photos without changing invoice details.
Use --data-only explicitly for invoices without photos; never use it to bypass a failed photo upload.`);
  process.exit(0);
}
if (flags.some((flag) => flag !== "--data-only")) throw new Error("Unknown import option.");
const base = process.env.BH_APP_URL;
const password = process.env.BH_ADMIN_PASSWORD;
if (!base || !password) {
  console.error("Set BH_APP_URL and BH_ADMIN_PASSWORD. The target must be explicit to avoid importing into the wrong database.");
  process.exit(1);
}
const endpoint = new URL("/api/app", base);
let cookie;
async function api(payload) {
  const multipart = payload instanceof FormData;
  const response = await fetch(endpoint, {
    method: payload ? "POST" : "GET",
    headers: { ...(!multipart ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: multipart ? payload : payload ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(60000),
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
    console.log(JSON.stringify({ capabilities: state.capabilities, types: state.types, paymentProfiles: state.admin.paymentProfiles,
      publishedInvoices: state.invoices.map(({ id, month, typeId, typeName }) =>
        ({ id, month, typeId, typeName })),
      completedMonths: state.summaries.map(({ month }) => month),
      existingInvoices: state.admin.payables.map(({ id, importKey, profileId, invoiceNumber, month, typeId, paidAt, photos }) =>
        ({ id, importKey, profileId, invoiceNumber, month, typeId, paidAt, photos })) }, null, 2));
  } else {
    const parsed = JSON.parse(await readFile(argument, "utf8"));
    const drafts = Array.isArray(parsed) ? parsed : [parsed];
    if (!drafts.length || drafts.some((item) => !item || typeof item !== "object" || Array.isArray(item) || !item.importKey)) {
      throw new Error("Provide one draft or an array of drafts, each with a stable importKey.");
    }
    // Preflight the entire batch before creating drafts. Never quietly omit missing files.
    for (const draft of drafts) {
      const files = draft.sourceFiles;
      if (!Array.isArray(files) || !files.length) {
        if (dataOnly && files == null) continue;
        throw new Error(`Invoice ${draft.importKey}: sourceFiles must list every invoice photo. Use --data-only only for a deliberate import without photos.`);
      }
      if (!state.capabilities?.invoicePhotos) throw new Error("The selected instance does not support photo archiving yet. Deploy the update before importing.");
      if (files.length > 20) throw new Error("An invoice can have up to 20 photos.");
      for (const path of files) {
        if (typeof path !== "string" || !path) throw new Error("Each sourceFiles entry must be a local file path.");
        const info = await stat(resolve(dirname(argument), path));
        if (!info.isFile() || !info.size || info.size > 10 * 1024 * 1024) throw new Error(`Photo ${path} must be a file between 1 byte and 10 MB.`);
      }
    }
    for (const [index, draft] of drafts.entries()) {
      const { sourceFiles = [], ...fields } = draft;
      const result = await api({ ...fields, action: "importPayable" });
      const expectedPhotos = [];
      for (const path of sourceFiles) {
        const bytes = await readFile(resolve(dirname(argument), path));
        const hash = createHash("sha256").update(bytes).digest("hex");
        const form = new FormData();
        form.set("id", String(result.importedId));
        form.set("photo", new Blob([bytes]), path.split(/[\\/]/).pop());
        const uploaded = await api(form);
        const expectedId = `${result.importedId}-${hash}`;
        if (uploaded.photoId !== expectedId) throw new Error("The server returned an unexpected photo checksum.");
        expectedPhotos.push(expectedId);
      }
      // Verify the committed archive, including existing photos on an interrupted retry.
      if (expectedPhotos.length) {
        const saved = (await api()).admin.payables.find((item) => item.id === result.importedId);
        if (!expectedPhotos.every((id) => saved?.photos.some((photo) => photo.id === id))) {
          throw new Error(`Invoice ${draft.importKey}: photo archive verification failed.`);
        }
      }
      console.log(JSON.stringify({ item: index + 1, id: result.importedId,
        status: result.duplicate ? "already imported; existing invoice details unchanged" : "saved as unpaid draft",
        photosArchived: new Set(expectedPhotos).size }));
    }
  }
} catch (error) {
  console.error(error.message);
  console.error("If a batch stopped partway through, retry the same file: existing details are retained and missing photos are added. Do not report photos archived until verification succeeds.");
  process.exitCode = 1;
}
