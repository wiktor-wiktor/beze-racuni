import type { InvoicePhoto } from "@/lib/invoice-photos";
import { MAX_PHOTO_BYTES, MAX_INVOICE_PHOTOS } from "@/lib/invoice-photos";
import { getPayable, PaymentError } from "./payments";

export const photoSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS invoice_photos (
    id TEXT PRIMARY KEY,
    payable_id INTEGER NOT NULL REFERENCES payable_invoices(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS invoice_photos_payable_idx ON invoice_photos(payable_id)`,
  `CREATE TABLE IF NOT EXISTS invoice_photo_chunks (
    photo_id TEXT NOT NULL REFERENCES invoice_photos(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (photo_id, sequence)
  )`,
];

export async function photoState(db: D1Database, publishedThrough?: string) {
  return (await db.prepare(`SELECT f.id, f.name, f.media_type AS mediaType,
      f.byte_size AS byteSize, f.payable_id AS payableId, p.invoice_id AS invoiceId
    FROM invoice_photos f JOIN payable_invoices p ON p.id = f.payable_id
    ${publishedThrough ? "WHERE p.paid_at IS NOT NULL AND p.invoice_id IS NOT NULL AND p.month <= ?" : ""}
    ORDER BY f.created_at, f.rowid`)
    .bind(...(publishedThrough ? [publishedThrough] : []))
    .all<InvoicePhoto & { payableId: number; invoiceId: number | null }>()).results ?? [];
}

function imageType(bytes: Uint8Array) {
  const begins = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (begins(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (begins(137, 80, 78, 71, 13, 10, 26, 10)) return "image/png";
  if (begins(82, 73, 70, 70) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new PaymentError("Use a JPEG, PNG, or WebP invoice photo.");
}

// Bound streamed bodies too: Content-Length is absent on some multipart uploads.
async function photoForm(request: Request) {
  const limit = MAX_PHOTO_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > limit) throw new PaymentError("Invoice photos must be 10 MB or smaller.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PaymentError("An invoice photo is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new PaymentError("Invoice photos must be 10 MB or smaller.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return await new Response(body, { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
  } catch {
    throw new PaymentError("Invalid photo upload.");
  }
}

export async function attachPhoto(db: D1Database, request: Request) {
  const form = await photoForm(request);
  const payable = await getPayable(db, form.get("id"));
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) throw new PaymentError("An invoice photo is required.");
  if (file.size > MAX_PHOTO_BYTES) throw new PaymentError("Invoice photos must be 10 MB or smaller.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mediaType = imageType(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `${payable.id}-${hash}`;
  const existing = await db.prepare("SELECT id FROM invoice_photos WHERE id = ?").bind(id).first();
  if (existing) return { photoId: id, duplicate: true };
  const count = await db.prepare("SELECT COUNT(*) AS count FROM invoice_photos WHERE payable_id = ?")
    .bind(payable.id).first<{ count: number }>();
  if ((count?.count ?? 0) >= MAX_INVOICE_PHOTOS) throw new PaymentError("An invoice can have up to 20 photos.");
  const name = file.name.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 255) || "Invoice photo";
  const statements = [db.prepare(`INSERT OR IGNORE INTO invoice_photos (id, payable_id, name, media_type, byte_size)
    VALUES (?, ?, ?, ?, ?)`).bind(id, payable.id, name, mediaType, bytes.length)];
  // Small BLOB rows also work with the local D1 runtime. No image decoder or
  // architecture-specific dependency is needed on the Nano; originals are unchanged.
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    statements.push(db.prepare("INSERT OR IGNORE INTO invoice_photo_chunks (photo_id, sequence, data) VALUES (?, ?, ?)")
      .bind(id, offset / chunkSize, bytes.slice(offset, offset + chunkSize).buffer));
  }
  await db.batch(statements);
  return { photoId: id, duplicate: false };
}

export async function servePhoto(db: D1Database, id: string, admin: boolean, publishedThrough: string) {
  const photo = await db.prepare(`SELECT f.media_type AS mediaType, f.byte_size AS byteSize
    FROM invoice_photos f JOIN payable_invoices p ON p.id = f.payable_id
    WHERE f.id = ? ${admin ? "" : "AND p.paid_at IS NOT NULL AND p.month <= ? AND EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id)"}`)
    .bind(id, ...(admin ? [] : [publishedThrough])).first<{ mediaType: string; byteSize: number }>();
  if (!photo) throw new PaymentError("That invoice photo is unavailable.", 404);
  const chunks = (await db.prepare("SELECT data FROM invoice_photo_chunks WHERE photo_id = ? ORDER BY sequence")
    .bind(id).all<{ data: number[] | ArrayBuffer | Uint8Array }>()).results ?? [];
  const bytes = new Uint8Array(photo.byteSize);
  let offset = 0;
  for (const chunk of chunks) {
    const data = chunk.data instanceof Uint8Array ? chunk.data : new Uint8Array(chunk.data);
    bytes.set(data, offset);
    offset += data.byteLength;
  }
  if (offset !== photo.byteSize) throw new PaymentError("The archived photo is incomplete.", 500);
  return new Response(bytes, { headers: {
    "Content-Type": photo.mediaType,
    "Content-Length": String(bytes.length),
    "Content-Disposition": "inline",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
