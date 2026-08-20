CREATE TABLE `bill_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_types_name_idx` ON `bill_types` (`name`);--> statement-breakpoint
CREATE TABLE `invoice_shares` (
	`invoice_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`weight` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`invoice_id`, `recipient_id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`type_id` integer NOT NULL,
	`type_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `bill_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_month_type_idx` ON `invoices` (`month`,`type_id`);--> statement-breakpoint
CREATE TABLE `month_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`total_cents` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `month_summaries_month_idx` ON `month_summaries` (`month`);--> statement-breakpoint
CREATE TABLE `month_summary_items` (
	`summary_id` integer NOT NULL,
	`recipient_id` integer NOT NULL,
	`recipient_name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	PRIMARY KEY(`summary_id`, `recipient_id`),
	FOREIGN KEY (`summary_id`) REFERENCES `month_summaries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipient_type_shares` (
	`recipient_id` integer NOT NULL,
	`type_id` integer NOT NULL,
	`weight` integer NOT NULL,
	PRIMARY KEY(`recipient_id`, `type_id`),
	FOREIGN KEY (`recipient_id`) REFERENCES `recipients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`type_id`) REFERENCES `bill_types`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recipients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
