import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
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
  const server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env, BH_NODE_RUNTIME: "1", BH_DB_PATH: join(directory, "test.sqlite"), ADMIN_PASSWORD: "test-invoice-password" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stdout.on("data", (chunk) => { logs += chunk; });
  server.stderr.on("data", (chunk) => { logs += chunk; });
  t.after(async () => {
    if (server.exitCode === null) {
      const stopped = new Promise((resolve) => server.once("exit", resolve));
      server.kill();
      await stopped;
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
  state = await api({ action: "setPayablePaid", id, paid: false });
  assert.equal(state.admin.payables[0].paidAt, null);
  assert.equal(state.admin.payables[0].invoiceId, null);
  assert.equal(state.invoices.length, 0);
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
  assert.equal(state.types.length, 4);
  await api({ action: "setPayablePaid", id: unmatched, paid: true }, 400);
  state = await api({ action: "deletePayable", id: unmatched });
  assert.ok(!state.admin.payables.some((p) => p.id === unmatched));
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
});
