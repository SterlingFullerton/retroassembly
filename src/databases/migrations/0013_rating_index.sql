-- Written by hand: drizzle-kit splits an expression with commas into quoted pieces. The snapshot has it right
CREATE INDEX `idx_roms_rating` ON `roms` (`user_id`,`status`,coalesce(json_extract(raw_game_metadata, '$.launchbox.communityRatingCount'), 0),coalesce(json_extract(raw_game_metadata, '$.launchbox.communityRating'), 0),`platform`,`disc_group`,`game_players`,`id`);
