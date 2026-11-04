CREATE TABLE `api_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`credits` integer NOT NULL,
	`status` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `api_usage_ts` ON `api_usage` (`ts`);--> statement-breakpoint
CREATE TABLE `checkpoints` (
	`seq` integer PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`memory_id` text,
	`prev_blob_id` text,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `closed_positions` (
	`address` text NOT NULL,
	`condition_id` text NOT NULL,
	`outcome_index` integer NOT NULL,
	`title` text,
	`slug` text,
	`event_slug` text,
	`outcome` text,
	`avg_price` real NOT NULL,
	`cur_price` real NOT NULL,
	`realized_pnl` real NOT NULL,
	`total_bought` real NOT NULL,
	`settled_at` integer NOT NULL,
	`group` text NOT NULL,
	PRIMARY KEY(`address`, `condition_id`, `outcome_index`)
);
--> statement-breakpoint
CREATE INDEX `closed_positions_address` ON `closed_positions` (`address`);--> statement-breakpoint
CREATE TABLE `holder_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` text NOT NULL,
	`market_id` text NOT NULL,
	`address` text NOT NULL,
	`outcome_index` integer NOT NULL,
	`size` real NOT NULL,
	`avg_price` real,
	`current_value` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `holder_snapshots_snapshot` ON `holder_snapshots` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `holder_snapshots_address` ON `holder_snapshots` (`address`);--> statement-breakpoint
CREATE TABLE `kv` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lambdas` (
	`group` text NOT NULL,
	`as_of` integer NOT NULL,
	`lambda` real NOT NULL,
	`n` integer NOT NULL,
	`brier_market` real,
	`brier_credence` real,
	PRIMARY KEY(`group`, `as_of`)
);
--> statement-breakpoint
CREATE TABLE `market_prices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id` text NOT NULL,
	`ts` integer NOT NULL,
	`prices` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_prices_market_ts` ON `market_prices` (`market_id`,`ts`);--> statement-breakpoint
CREATE TABLE `markets` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`event_id` text,
	`question` text NOT NULL,
	`api_category` text,
	`group` text DEFAULT 'OTHER' NOT NULL,
	`tags` text,
	`status` text,
	`close_time` integer,
	`outcomes` text NOT NULL,
	`volume` real,
	`liquidity` real,
	`resolution` text,
	`url` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`job_id` text,
	`blob_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`effect` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	`stored_at` integer
);
--> statement-breakpoint
CREATE INDEX `memories_status` ON `memories` (`status`);--> statement-breakpoint
CREATE INDEX `memories_ref` ON `memories` (`ref_type`,`ref_id`);--> statement-breakpoint
CREATE TABLE `picks` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`market_id` text NOT NULL,
	`outcome_index` integer NOT NULL,
	`outcome_name` text NOT NULL,
	`confidence` real NOT NULL,
	`reason` text,
	`price_at_pick` real NOT NULL,
	`kalshi_at_pick` real,
	`line_at_pick` real,
	`created_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`settled_at` integer,
	`y` real,
	`edge` real,
	`brier_user` real,
	`brier_market` real,
	`memory_id` text,
	`receipt_id` text
);
--> statement-breakpoint
CREATE INDEX `picks_handle` ON `picks` (`handle`);--> statement-breakpoint
CREATE INDEX `picks_market` ON `picks` (`market_id`);--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` integer NOT NULL,
	`ref_id` text NOT NULL,
	`digest` text NOT NULL,
	`tx_digest` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sharp_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`market_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`ts` integer NOT NULL,
	`price_a` real NOT NULL,
	`consensus` real,
	`line` real,
	`weight` real NOT NULL,
	`lambda` real NOT NULL,
	`contributors` text NOT NULL,
	`call_memory_id` text
);
--> statement-breakpoint
CREATE INDEX `sharp_lines_market_ts` ON `sharp_lines` (`market_id`,`ts`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`market_id` text NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`prices` text
);
--> statement-breakpoint
CREATE INDEX `snapshots_market_ts` ON `snapshots` (`market_id`,`ts`);--> statement-breakpoint
CREATE TABLE `venue_pairs` (
	`poly_id` text PRIMARY KEY NOT NULL,
	`kalshi_id` text NOT NULL,
	`flip` integer DEFAULT false NOT NULL,
	`score` real NOT NULL,
	`method` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voice_scores` (
	`voice_id` text NOT NULL,
	`group` text NOT NULL,
	`as_of` integer NOT NULL,
	`n` integer NOT NULL,
	`wins` integer NOT NULL,
	`edge` real NOT NULL,
	`z` real NOT NULL,
	`credibility` real NOT NULL,
	`pnl` real NOT NULL,
	`volume` real NOT NULL,
	PRIMARY KEY(`voice_id`, `group`, `as_of`)
);
--> statement-breakpoint
CREATE TABLE `wallets` (
	`address` text PRIMARY KEY NOT NULL,
	`name` text,
	`x_username` text,
	`verified` integer DEFAULT false NOT NULL,
	`profile_image` text,
	`last_history_at` integer,
	`history_stale` integer DEFAULT false NOT NULL
);
