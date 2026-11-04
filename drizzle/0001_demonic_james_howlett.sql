ALTER TABLE `markets` ADD `resolve_checks` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `markets` ADD `next_resolve_check_at` integer;