# Project instructions

- If asked to make changes, you may change files that already have uncommitted changes.
- When asked to make changes, assess the validity of the request first and suggest a better approach if there is a good reason.
- When asked to read invoice pictures or import invoices, follow [docs/invoice-import.md](docs/invoice-import.md). Use the authenticated import command to save unpaid drafts to the explicitly configured app instance; do not write directly to SQLite or mark invoices paid as part of extraction. Keep recipient details sourced from the payment directory.
