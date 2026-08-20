ALTER TABLE `bill_types` ADD `icon` text DEFAULT '•' NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `type_icon` text DEFAULT '•' NOT NULL;