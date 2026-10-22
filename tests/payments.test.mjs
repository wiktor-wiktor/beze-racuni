import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import test from "node:test";

// Run after a BH_NODE_RUNTIME=1 build; never touches a household database.
test("invoice imports remain private until payment, with reversible publication and safe duplicates", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bh-payments-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const serverEnv = { ...process.env, BH_NODE_RUNTIME: "1", BH_DB_PATH: join(directory, "test.sqlite"), ADMIN_PASSWORD: "test-invoice-password" };
  const server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  let restarted;
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    for (const process of [server, restarted]) {
      if (process && process.exitCode === null && process.signalCode === null) {
        const stopped = new Promise((resolve) => process.once("exit", resolve));
        process.kill();
        await stopped;
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}/api/app`;
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* starting */ }
    if (attempt >= 80 || server.exitCode !== null) throw new Error(`Test server failed: ${logs}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  let cookie = "";
  async function api(payload, status = 200, authenticated = true) {
    const response = await fetch(url, {
      method: payload ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...(authenticated && cookie ? { Cookie: cookie } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const next = response.headers.getSetCookie()[0];
    if (next) cookie = next.split(";")[0];
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  await api({ action: "importPayable" }, 401, false);
  let state = await api({ action: "login", password: "test-invoice-password" });
  const types = state.types;
  assert.equal(state.admin.paymentProfiles.length, 8);
  assert.equal(types.length, 4);
  const gas = types.find((type) => type.name === "Gas");
  const profiles = state.admin.paymentProfiles;
  assert.equal(profiles.find((p) => p.id === "plin").receiverName, "GEN-I, d.o.o.");
  assert.notEqual(profiles.find((p) => p.id === "voda").iban, profiles.find((p) => p.id === "snaga").iban);
  const draft = { action: "importPayable", importKey: "gas:test-001", profileId: "plin", typeId: gas.id,
    month: "2026-08", amount: "42,31", invoiceNumber: "test-001", issuedOn: "2026-09-01", dueOn: "2026-09-20",
    transactionTitle: "Plin 08/2026", reference: "SI00 001234", sourceName: "test-gas.jpg", notes: "Check extraction",
    iban: "INJECTED", receiverName: "INJECTED" };
  state = await api(draft);
  const id = state.importedId;
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XkAAAAASUVORK5CYII=", "base64");
  const photo = Buffer.concat([pixel, Buffer.alloc(2_600_000)]); // Crosses BLOB rows and the framework's default 1 MB limit.
  async function upload(bytes, name = "invoice.png", status = 200, authenticated = true, payableId = id) {
    const form = new FormData();
    form.set("id", String(payableId));
    form.set("photo", new Blob([bytes], { type: "image/png" }), name);
    const response = await fetch(url, { method: "POST", headers: authenticated ? { Cookie: cookie } : {}, body: form });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }
  await upload(photo, "invoice.png", 401, false);
  await upload(pixel, "unknown.png", 404, true, 99999);
  await upload(Buffer.alloc(0), "empty.png", 400);
  await upload(Buffer.from("<svg onload=alert(1)></svg>"), "disguised.png", 400);
  await upload(Buffer.alloc(10 * 1024 * 1024 + 1), "large.png", 413);
  const archived = await upload(photo);
  const photoId = archived.photoId;
  assert.equal(photoId, `${id}-${createHash("sha256").update(photo).digest("hex")}`);
  assert.equal((await upload(photo, "renamed.png")).duplicate, true);
  const secondPhoto = await upload(pixel, "page-2.png");
  const photoUrl = `${url}?photo=${photoId}`;
  assert.equal((await fetch(photoUrl)).status, 404);
  const privatePhoto = await fetch(photoUrl, { headers: { Cookie: cookie } });
  assert.equal(privatePhoto.headers.get("content-type"), "image/png");
  assert.equal(privatePhoto.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await privatePhoto.arrayBuffer()), photo);
  state = await api();
  assert.equal(state.admin.payables[0].photos.length, 2);
  let entry = state.admin.payables[0];
  assert.equal(entry.amountCents, 4231);
  assert.equal(entry.receiverName, "GEN-I, d.o.o.");
  assert.equal(entry.iban, "SI56 2900 0015 5731 029");
  assert.equal(entry.reference, "SI00 001234");
  assert.equal(state.invoices.length, 0);
  assert.equal(entry.paidAt, null);
  const publicData = await api(undefined, 200, false);
  assert.equal(publicData.admin, null);
  assert.equal(publicData.invoices.length, 0);
  assert.doesNotMatch(JSON.stringify(publicData), /001234|test-gas|SI56|Check extraction/);
  state = await api({ ...draft, amount: "999" });
  assert.equal(state.duplicate, true);
  assert.equal(state.importedId, id);
  assert.equal(state.admin.payables.length, 1);
  assert.equal(state.admin.payables[0].amountCents, 4231);
  state = await api({ ...draft, importKey: "different-source-file" });
  assert.equal(state.duplicate, true);
  for (const invalid of [{ amount: "1.001" }, { amount: "-2" }, { dueOn: "2026-02-30" }, { profileId: "unknown" }, { typeId: 9999 }]) {
    await api({ ...draft, ...invalid }, 400);
  }
  await api({ action: "setPayablePaid", id, paid: true }, 400); // No configured shares.
  state = await api();
  assert.equal(state.admin.payables[0].paidAt, null);
  assert.equal(state.invoices.length, 0);
  const shares = Object.fromEntries(types.map((type) => [type.id, 1]));
  await api({ action: "addRecipient", name: "Alex", shares });
  await api({ action: "addRecipient", name: "Sam", shares });
  await api({ ...draft, action: "updatePayable", id, amount: "42.33" });
  state = await api({ action: "setPayablePaid", id, paid: true });
  entry = state.admin.payables[0];
  assert.ok(entry.paidAt);
  assert.equal(entry.invoiceId, state.invoices[0].id);
  assert.equal(state.invoices[0].amountCents, 4233);
  assert.deepEqual(state.invoices[0].shares.map((s) => s.amountCents).sort(), [2116, 2117]);
  await api({ ...draft, action: "updatePayable", id }, 409);
  await api({ action: "deletePayable", id }, 409);
  state = await api({ action: "setPayablePaid", id, paid: true });
  assert.equal(state.invoices.length, 1);
  assert.equal((await api(undefined, 200, false)).invoices.length, 1);
  const published = (await api(undefined, 200, false)).invoices[0];
  assert.equal(published.photos.length, 2);
  assert.deepEqual(Buffer.from(await (await fetch(photoUrl)).arrayBuffer()), photo);
  // An isolated second SQLite connection sees durable originals, not temporary files.
  const archiveDb = new DatabaseSync(join(directory, "test.sqlite"));
  assert.equal(archiveDb.prepare("SELECT SUM(length(data)) AS bytes FROM invoice_photo_chunks WHERE photo_id = ?").get(photoId).bytes, photo.length);
  archiveDb.close();
  state = await api({ action: "setPayablePaid", id, paid: false });
  assert.equal(state.admin.payables[0].paidAt, null);
  assert.equal(state.admin.payables[0].invoiceId, null);
  assert.equal(state.invoices.length, 0);
  assert.equal((await fetch(photoUrl)).status, 404); // Revoked even with the old URL.
  assert.equal(state.admin.payables[0].photos.length, 2);
  assert.equal((await fetch(`${url}?photo=${secondPhoto.photoId}`, { headers: { Cookie: cookie } })).status, 200);
  // Complete a month, then undo one payment and confirm both summary and shares are rebuilt.
  for (const type of types) {
    const imported = type.id === gas.id ? { importedId: id } : await api({ ...draft,
      importKey: `service:${type.id}`, invoiceNumber: `test-${type.id}`, typeId: type.id });
    state = await api({ action: "setPayablePaid", id: imported.importedId, paid: true });
  }
  assert.equal(state.summaries.length, 1);
  assert.equal(state.summaries[0].totalCents, 16926);
  state = await api({ action: "setPayablePaid", id, paid: false });
  assert.equal(state.summaries.length, 0);
  assert.equal(state.invoices.length, 3);
  state = await api({ action: "setPayablePaid", id, paid: true });
  assert.equal(state.summaries.length, 1);
  assert.equal(state.summaries[0].items.reduce((sum, item) => sum + item.amountCents, 0), 16926);
  // An unsupported profile stays available without changing active service configuration.
  state = await api({ ...draft, importKey: "future-rtv", invoiceNumber: "rtv-001", profileId: "rtv", typeId: null });
  const unmatched = state.importedId;
  const removedPhoto = await upload(pixel, "unmatched.png", 200, true, unmatched);
  assert.equal(state.types.length, 4);
  await api({ action: "setPayablePaid", id: unmatched, paid: true }, 400);
  state = await api({ action: "deletePayable", id: unmatched });
  assert.ok(!state.admin.payables.some((p) => p.id === unmatched));
  assert.equal((await fetch(`${url}?photo=${removedPhoto.photoId}`, { headers: { Cookie: cookie } })).status, 404);
  const deletedDb = new DatabaseSync(join(directory, "test.sqlite"));
  assert.equal(deletedDb.prepare("SELECT COUNT(*) AS count FROM invoice_photo_chunks WHERE photo_id = ?").get(removedPhoto.photoId).count, 0);
  deletedDb.close();
  // A same-service/month conflict must leave the second draft unpaid.
  state = await api({ ...draft, importKey: "gas-second", invoiceNumber: "gas-second" });
  const conflict = state.importedId;
  await api({ action: "setPayablePaid", id: conflict, paid: true }, 409);
  state = await api();
  assert.equal(state.admin.payables.find((p) => p.id === conflict).paidAt, null);
  const publishedId = state.admin.payables.find((p) => p.id === id).invoiceId;
  state = await api({ action: "deleteInvoice", id: publishedId });
  assert.equal(state.admin.payables.find((p) => p.id === id).invoiceId, null);
  assert.equal(state.admin.payables.find((p) => p.id === id).paidAt, null);
  assert.equal(state.summaries.length, 0);
  // Replacing which draft is paid does not duplicate published entries.
  state = await api({ action: "setPayablePaid", id, paid: true });
  await api({ action: "setPayablePaid", id, paid: false });
  await api({ action: "setPayablePaid", id: conflict, paid: true });
  await api({ action: "setPayablePaid", id, paid: true }, 409);
  state = await api();
  assert.equal(state.admin.payables.find((p) => p.id === id).paidAt, null);
  assert.equal(state.invoices.length, 4);
  const first = await api({ ...draft, month: "2026-07", importKey: "july-a", invoiceNumber: "july-a" });
  const second = await api({ ...draft, month: "2026-07", importKey: "july-b", invoiceNumber: "july-b" });
  await api({ action: "setPayablePaid", id: first.importedId, paid: true });
  // This month remains open, so the duplicate fails inside the publication transaction.
  await api({ action: "setPayablePaid", id: second.importedId, paid: true }, 409);
  state = await api();
  assert.equal(state.admin.payables.find((p) => p.id === second.importedId).paidAt, null);
  assert.equal(state.invoices.filter((i) => i.month === "2026-07").length, 1);
  // Future paid invoices keep photos private until their collection month.
  const future = await api({ ...draft, month: "2099-01", importKey: "future-photo", invoiceNumber: "future-photo" });
  const futurePhoto = await upload(pixel, "future.png", 200, true, future.importedId);
  await api({ action: "setPayablePaid", id: future.importedId, paid: true });
  assert.equal((await fetch(`${url}?photo=${futurePhoto.photoId}`)).status, 404);
  assert.deepEqual((await api(undefined, 200, false)).invoices.find((i) => i.month === "2099-01").photos, []);
  // Exercise the actual intake command, including file paths, interrupted retries and old instances.
  await writeFile(join(directory, "source.png"), pixel);
  const cliDraft = { ...draft, importKey: "cli-photo", invoiceNumber: "cli-photo", sourceFiles: ["source.png"] };
  const jsonPath = join(directory, "invoice.json");
  async function cli() {
    const child = spawn(process.execPath, ["scripts/import-invoices.mjs", jsonPath], {
      env: { ...process.env, BH_APP_URL: `http://127.0.0.1:${port}`, BH_ADMIN_PASSWORD: "test-invoice-password" },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    return { code: await new Promise((resolve) => child.on("close", resolve)), output };
  }
  await writeFile(jsonPath, JSON.stringify({ ...cliDraft, sourceFiles: ["missing.png"] }));
  assert.equal((await cli()).code, 1);
  assert.ok(!(await api()).admin.payables.some((p) => p.importKey === cliDraft.importKey));
  // Existing invoice without photos simulates a successful draft save followed by a failed upload.
  const partial = await api(cliDraft);
  await writeFile(jsonPath, JSON.stringify(cliDraft));
  for (let retry = 0; retry < 2; retry++) {
    const result = await cli();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /"photosArchived":1/);
  }
  state = await api();
  const saved = state.admin.payables.find((p) => p.id === partial.importedId);
  assert.equal(saved.photos.length, 1);
  assert.equal(saved.paidAt, null);
  // A real process restart must preserve the original bytes and existing attachment URLs.
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
  await stopped;
  restarted = spawn(process.execPath, server.spawnargs.slice(1), { env: serverEnv, stdio: "ignore" });
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(url)).ok) break; } catch { /* restarting */ }
    if (attempt >= 80 || restarted.exitCode !== null) throw new Error("Archive restart failed.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const restored = await fetch(photoUrl, { headers: { Cookie: cookie } });
  assert.equal(restored.status, 200);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), photo);
});
