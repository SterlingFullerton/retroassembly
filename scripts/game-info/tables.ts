// The game info database's tables, as SQL, for scripts/game-info.ts. The same as schema.ts
export const gameInfoTables = `
CREATE TABLE launchbox_games (
  community_rating REAL, community_rating_count INTEGER, compact_name TEXT NOT NULL, cooperative INTEGER,
  database_id INTEGER PRIMARY KEY NOT NULL, developer TEXT, dos TEXT, esrb TEXT, genres TEXT,
  goodcodes_base_compact_name TEXT NOT NULL, max_players INTEGER, name TEXT NOT NULL, overview TEXT, platform TEXT,
  publisher TEXT, release_date INTEGER, release_type TEXT, release_year TEXT, setup_file TEXT, setup_md5 TEXT,
  startup_file TEXT, startup_md5 TEXT, startup_parameters TEXT, steam_app_id TEXT, video_url TEXT, wikipedia_url TEXT
);
CREATE TABLE launchbox_game_alternate_names (
  alternate_name TEXT, compact_name TEXT, database_id INTEGER, id INTEGER PRIMARY KEY, region TEXT
);
CREATE TABLE libretro_games (
  compact_name TEXT NOT NULL, crc TEXT, description TEXT, developer TEXT, esrb_rating TEXT, franchise TEXT, genre TEXT,
  goodcodes_base_compact_name TEXT NOT NULL, id TEXT PRIMARY KEY NOT NULL, md5 TEXT, name TEXT, origin TEXT,
  platform TEXT, publisher TEXT, releasemonth INTEGER, releaseyear INTEGER, rom_name TEXT, sha1 TEXT, size INTEGER,
  users INTEGER
);
`

export const gameInfoIndexes = `
CREATE INDEX idx_launchbox_games_compact_name ON launchbox_games (compact_name);
CREATE INDEX idx_launchbox_games_goodcodes_compact_name ON launchbox_games (goodcodes_base_compact_name);
CREATE INDEX idx_launchbox_game_alternate_name_compact_name ON launchbox_game_alternate_names (compact_name);
CREATE INDEX idx_libretro_games_md5 ON libretro_games (md5);
CREATE INDEX idx_libretro_games_rom_name ON libretro_games (rom_name);
CREATE INDEX idx_libretro_games_name ON libretro_games (name);
CREATE INDEX idx_libretro_games_compact_name ON libretro_games (compact_name);
CREATE INDEX idx_libretro_games_goodcodes_base_compact_name ON libretro_games (goodcodes_base_compact_name);
`
