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

The local-development admin password defaults to `rachunki123#`. Set
`ADMIN_PASSWORD` through Wrangler's environment file for a deployed instance.

## Invoice inbox

Attach invoice pictures to a Codex task in this project to import private unpaid drafts.
The admin inbox provides click-to-copy bank transfer details from the supplied payment
directory. Source photos are archived with the invoice, with thumbnails and a full-size
viewer. Marking an invoice paid publishes its household split and photos and moves it to paid
history. See [the invoice import guide](docs/invoice-import.md) for setup and usage.

## How splitting works

Weights are relative per bill type. If Alex has weight 1 and Sam has weight 2
for Water, Alex pays one third and Sam pays two thirds. A weight of 0 means the
person does not share that bill.

Each invoice stores a snapshot of the names, weights, and calculated amounts
used at the time it was added. Later configuration changes therefore affect
future invoices only. When one invoice exists for every active bill type, the
month closes automatically and a final summary appears in the public feed.

Data is stored in the project-local Cloudflare D1 development database.

## Deploy to the Jetson Nano

The Nano deployment runs as an ARM64 Docker container and listens on all of
the Nano's interfaces. Its SQLite state lives on the host in
`~/.local/share/bezenskova-house/data`, outside the container. The first
deployment seeds it from the current local D1 database; subsequent
deployments retain it and apply additive schema updates automatically. Invoice photos live
in this same persistent database, so container replacements and database backups retain
the originals without an extra storage service or ARM image-processing dependency.

Requirements on the development Mac and Nano are Docker, SSH, `curl`, and
`sqlite3` on the Mac. Set the Nano SSH target and deploy:

```bash
BH_JETSON_TARGET=user@c-desktop npm run deploy:jetson
```

The deploy command runs the local test suite, builds an ARM64 image, transfers
it, seeds data only when the remote database does not exist, and starts the
container with a restart policy. It health-checks the new release and restores
the previous image if startup fails. The service uses port `3007` by default;
override it with `BH_PORT` if needed.

The production admin password is stored only on the Nano in
`~/.local/share/bezenskova-house/app.env`. Change it there and restart the
container to rotate the password:

```bash
docker restart bezenskova-house
```

## Useful commands

```bash
npm run build
npm run lint
npm run db:generate
```
