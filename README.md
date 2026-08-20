# Bezenškova House

A locally hosted household bill ledger. It has a public feed for everyone on
the local network and a password-protected admin area for managing bill types,
recipients, weighted shares, and monthly invoices.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local address printed in the terminal. Other devices on the same
network can use the printed network address.

The default admin password is `rachunki123`. Change the `ADMIN_PASSWORD`
constant in `app/api/app/route.ts` before regular use.

## How splitting works

Weights are relative per bill type. If Alex has weight 1 and Sam has weight 2
for Water, Alex pays one third and Sam pays two thirds. A weight of 0 means the
person does not share that bill.

Each invoice stores a snapshot of the names, weights, and calculated amounts
used at the time it was added. Later configuration changes therefore affect
future invoices only. When one invoice exists for every active bill type, the
month closes automatically and a final summary appears in the public feed.

Data is stored in the project-local Cloudflare D1 development database.

## Useful commands

```bash
npm run build
npm run lint
npm run db:generate
```
