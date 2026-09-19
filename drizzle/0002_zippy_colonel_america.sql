CREATE TABLE `payable_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`import_key` text NOT NULL,
	`profile_id` text NOT NULL,
	`type_id` integer,
	`month` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`invoice_number` text DEFAULT '' NOT NULL,
	`issued_on` text DEFAULT '' NOT NULL,
	`due_on` text DEFAULT '' NOT NULL,
	`transaction_title` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`source_name` text DEFAULT '' NOT NULL,
	`iban` text NOT NULL,
	`receiver_name` text NOT NULL,
	`street` text NOT NULL,
	`postal_code` text NOT NULL,
	`city` text NOT NULL,
	`invoice_id` integer,
	`paid_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `bill_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payable_invoices_import_key_unique` ON `payable_invoices` (`import_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `payable_invoices_invoice_id_unique` ON `payable_invoices` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payable_invoice_number_idx` ON `payable_invoices` (`profile_id`,`invoice_number`) WHERE "payable_invoices"."invoice_number" <> '';