export type InvoicePhoto = {
  id: string;
  name: string;
  mediaType: string;
  byteSize: number;
};

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_INVOICE_PHOTOS = 20;
export const photoUrl = (id: string) => `/api/app?photo=${encodeURIComponent(id)}`;
