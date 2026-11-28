CREATE TABLE `library_version` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
-- Written by hand from here to the indexes: Drizzle has no triggers. Any change to the games or the favorites moves the
-- version on, so the server knows when a search's matches it kept are out of date
INSERT INTO `library_version` (`id`, `version`) VALUES (1, 0);--> statement-breakpoint
CREATE TRIGGER `library_version_roms_insert` AFTER INSERT ON `roms` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
CREATE TRIGGER `library_version_roms_update` AFTER UPDATE ON `roms` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
CREATE TRIGGER `library_version_roms_delete` AFTER DELETE ON `roms` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
CREATE TRIGGER `library_version_favorites_insert` AFTER INSERT ON `favorites` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
CREATE TRIGGER `library_version_favorites_update` AFTER UPDATE ON `favorites` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
CREATE TRIGGER `library_version_favorites_delete` AFTER DELETE ON `favorites` BEGIN UPDATE `library_version` SET `version` = `version` + 1; END;--> statement-breakpoint
-- An account has one row of settings. Should one have more, the one the server read and saved over (the first) is kept
DELETE FROM `user_preferences` WHERE `rowid` NOT IN (SELECT min(`rowid`) FROM `user_preferences` GROUP BY `user_id`);--> statement-breakpoint
DROP INDEX `idx_user_preferences`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_preferences` ON `user_preferences` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_favorites_rom` ON `favorites` (`rom_id`);--> statement-breakpoint
CREATE INDEX `idx_game_saves_rom` ON `game_saves` (`rom_id`);--> statement-breakpoint
CREATE INDEX `idx_launch_records_rom` ON `launch_records` (`rom_id`);
