CREATE TABLE `invoice_photo_chunks` (
	`photo_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`data` blob NOT NULL,
	PRIMARY KEY(`photo_id`, `sequence`),
	FOREIGN KEY (`photo_id`) REFERENCES `invoice_photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoice_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`payable_id` integer NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`payable_id`) REFERENCES `payable_invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_photos_payable_idx` ON `invoice_photos` (`payable_id`);