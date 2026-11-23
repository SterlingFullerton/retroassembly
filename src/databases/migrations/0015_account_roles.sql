ALTER TABLE `users` ADD `role` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
-- The admin was whichever account was the oldest still in use; now it says so
UPDATE `users` SET `role` = 'admin' WHERE `id` = (SELECT `id` FROM `users` WHERE `status` = 1 ORDER BY `created_at` ASC LIMIT 1);
