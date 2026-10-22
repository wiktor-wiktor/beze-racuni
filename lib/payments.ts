import type { InvoicePhoto } from "./invoice-photos";

export type PaymentProfile = {
  id: string;
  label: string;
  iban: string;
  receiverName: string;
  street: string;
  postalCode: string;
  city: string;
};

export type Payable = {
  id: number;
  importKey: string;
  profileId: string;
  typeId: number | null;
  typeName: string | null;
  month: string;
  amountCents: number;
  invoiceNumber: string;
  issuedOn: string;
  dueOn: string;
  transactionTitle: string;
  reference: string;
  notes: string;
  sourceName: string;
  photos: InvoicePhoto[];
  iban: string;
  receiverName: string;
  street: string;
  postalCode: string;
  city: string;
  invoiceId: number | null;
  paidAt: string | null;
  createdAt: string;
};

export type PaymentAdminData = {
  paymentProfiles: PaymentProfile[];
  payables: Payable[];
};
