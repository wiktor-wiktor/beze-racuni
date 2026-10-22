"use client";

import { useRef, useState } from "react";
import { photoUrl, type InvoicePhoto } from "@/lib/invoice-photos";

export default function InvoicePhotos({ photos = [] }: { photos?: InvoicePhoto[] }) {
  const [expanded, setExpanded] = useState(false);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  if (!photos.length) return null;
  const current = photos[index] ?? photos[0];
  function select(next: number) { setIndex(next); setFailed(false); }
  return <section className="invoice-photos" aria-label="Invoice photos">
    <button type="button" className="text-button photo-toggle" aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>
      {expanded ? "Hide" : "View"} invoice {photos.length === 1 ? "photo" : "photos"} ({photos.length})
    </button>
    {expanded && <div className="photo-thumbnails">
      {photos.map((photo, position) => <button type="button" className="photo-thumbnail" key={photo.id}
        aria-label={`Open invoice photo ${position + 1}: ${photo.name}`}
        onClick={() => { select(position); setViewing(true); dialog.current?.showModal(); }}>
        {/* Original images bypass image optimization so the Nano needs no image processing service. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(photo.id)} alt={`Invoice page ${position + 1}`} loading="lazy" />
        <span>Page {position + 1}</span>
      </button>)}
    </div>}
    <dialog className="photo-dialog" ref={dialog} aria-label="Invoice photo viewer" onClose={() => setViewing(false)}>
      <div className="photo-viewer-header">
        <div><strong>Invoice photo {index + 1} of {photos.length}</strong><p>{current.name}</p></div>
        <button type="button" className="button ghost" onClick={() => dialog.current?.close()} autoFocus>Close</button>
      </div>
      <div className="photo-viewer-image">
        {viewing && (failed ? <p role="alert">This photo could not be loaded. Close the viewer and refresh the page to try again.</p> :
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={current.id} src={photoUrl(current.id)} alt={`Invoice page ${index + 1}: ${current.name}`}
            onError={() => setFailed(true)} />)}
      </div>
      <div className="photo-viewer-footer">
        <button type="button" className="button ghost" disabled={index === 0} onClick={() => select(index - 1)}>Previous</button>
        <a className="text-button" href={photoUrl(current.id)} target="_blank" rel="noreferrer">Open original ↗</a>
        <button type="button" className="button ghost" disabled={index === photos.length - 1} onClick={() => select(index + 1)}>Next</button>
      </div>
    </dialog>
  </section>;
}
