import type { PaymentProfile } from "@/lib/payments";

// User-supplied payment directory. Never replace these details with OCR output.
export const paymentProfiles: PaymentProfile[] = [
  { id: "plin", label: "Plin", iban: "SI56 2900 0015 5731 029", receiverName: "GEN-I, d.o.o.", street: "Vrbina 17", postalCode: "8270", city: "Krsko" },
  { id: "energija", label: "Energija", iban: "SI56 2900 0015 5731 029", receiverName: "GEN-I, d.o.o.", street: "Vrbina 17", postalCode: "8270", city: "Krsko" },
  { id: "t-2", label: "T-2", iban: "SI56 0430 2000 3519 144", receiverName: "T-2 d.o.o.", street: "Verovskova ulica 64a", postalCode: "1000", city: "Ljubljana" },
  { id: "a1", label: "A1", iban: "SI56 2900 0015 9800 373", receiverName: "A1 Slovenija, d. d.", street: "Ameriska ulica 4", postalCode: "1000", city: "Ljubljana" },
  { id: "voda", label: "voda", iban: "SI56 2900 0000 3057 588", receiverName: "JP Voka Snaga d.o.o.", street: "Vodovodna cesta 90", postalCode: "1000", city: "Ljubljana" },
  { id: "snaga", label: "snaga", iban: "SI56 0400 1004 9142 226", receiverName: "JP Voka Snaga d.o.o.", street: "Vodovodna cesta 90", postalCode: "1000", city: "Ljubljana" },
  { id: "rtv", label: "RTV", iban: "SI56 0110 0849 3106 536", receiverName: "RTV Slovenija", street: "Kolodvorska 2", postalCode: "1550", city: "Ljubljana" },
  { id: "elektro-ljubljana", label: "Elektro Ljubljana", iban: "SI56 0400 0027 7758 180", receiverName: "Elektro Ljubljana d.d.", street: "Slovenska cesta 56", postalCode: "1516", city: "Ljubljana" },
];
