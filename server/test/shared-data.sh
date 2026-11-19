#!/bin/bash
# Checks that the Node server and the Go server can share a data folder at once, each using the accounts, sessions and
# files the other made. Start both on the same empty data folder, then:
#   DATA_DIRECTORY=<that folder> NODE_URL=http://localhost:8100 GO_URL=http://localhost:8101 server/test/shared-data.sh
# Needs curl, sqlite3, shasum and node
N=${NODE_URL:-http://localhost:8100}
G=${GO_URL:-http://localhost:8101}
DB=${DATA_DIRECTORY:?set DATA_DIRECTORY to the data folder both servers use}/retroassembly.sqlite
S=$(mktemp -d)
trap 'rm -rf "$S"' EXIT
fail=0
check() { # description, expected, actual
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected [$2] got [$3]"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(s?JSON.parse(s)[process.argv[1]]:""))' "$1"; }
file_headers() { # base url, file id: the headers that must be the same from both servers
  curl -s -D - -o /dev/null -b $S/jar-n "$1/api/v1/files/$2" | tr -d '\r' \
    | grep -iE '^(etag|content-type|content-length|content-security-policy|x-content-type-options|accept-ranges):' \
    | tr 'A-Z' 'a-z' | sort
}

head -c 300000 /dev/urandom > $S/game.nes
printf 'state-bytes' > $S/state.bin
printf '\x89PNG\r\n\x1a\nthumb' > $S/thumb.png
printf '\x89PNG\r\n\x1a\nboxart' > $S/boxart.png

echo "# Node: an account, a game, a save state, box art"
check "node register" 200 "$(code -c $S/jar-n -X POST -F username=alice -F password=alice-pass-1 $N/api/v1/auth/register)"
ROM_ID=$(curl -s -b $S/jar-n -F platform=nes -F "file=@$S/game.nes;filename=Cross Game.nes" $N/api/v1/roms | json id)
FILE_ID=$(sqlite3 $DB "select file_id from roms where id='$ROM_ID'")
check "node uploaded the game" "roms/nes" "$(dirname "$FILE_ID")"
curl -s -o /dev/null -b $S/jar-n -F core=fceumm -F rom=$ROM_ID -F type=manual -F "state=@$S/state.bin" \
  -F "thumbnail=@$S/thumb.png;type=image/png" $N/api/v1/states
STATE_FILE=$(sqlite3 $DB "select file_id from states where rom_id='$ROM_ID' limit 1")
THUMB_FILE=$(sqlite3 $DB "select thumbnail_file_id from states where rom_id='$ROM_ID' limit 1")
BOXART=$(curl -s -b $S/jar-n -F "file=@$S/boxart.png;filename=box.png" $N/api/v1/roms/$ROM_ID/boxart | tr -d '"')

echo "# Go: signs in Node's account, and sends Node's files"
check "go login with node's password hash" 200 "$(code -c $S/jar-g -X POST -F username=alice -F password=alice-pass-1 $G/api/v1/auth/login)"
check "go wrong password" 401 "$(code -X POST -F username=alice -F password=nope $G/api/v1/auth/login)"
check "go knows node's session" alice "$(curl -s -b $S/jar-n $G/api/v1/users/current | json username)"
curl -s -b $S/jar-n -o $S/game-from-go.nes "$G/api/v1/files/$FILE_ID"
check "go sends node's game, byte for byte" "$(shasum < $S/game.nes)" "$(shasum < $S/game-from-go.nes)"
for f in "$FILE_ID" "$STATE_FILE" "$THUMB_FILE" "$BOXART"; do
  check "same headers for $f" "$(file_headers $N "$f")" "$(file_headers $G "$f")"
done
range() { # base url, output file
  curl -s -D - -o "$2" -b $S/jar-n -H 'Range: bytes=100-199' "$1/api/v1/files/$FILE_ID" | tr -d '\r' \
    | grep -iE '^(HTTP|content-range|content-length)' | tr 'A-Z' 'a-z' | sort
}
check "same partial answer" "$(range $N $S/range-n)" "$(range $G $S/range-g)"
check "same partial bytes" "$(shasum < $S/range-n)" "$(shasum < $S/range-g)"
ETAG=$(curl -s -D - -o /dev/null -b $S/jar-n "$G/api/v1/files/$FILE_ID" | tr -d '\r' | awk -F': ' 'tolower($1)=="etag"{print $2}')
check "go 304 for the same etag" 304 "$(code -b $S/jar-n -H "If-None-Match: $ETAG" "$G/api/v1/files/$FILE_ID")"

echo "# Node: signs in Go's account, and knows Go's session"
check "go register" 200 "$(code -c $S/jar-bob -X POST -F username=bob -F password=bob-pass-1 $G/api/v1/auth/register)"
check "node login with go's password hash" 200 "$(code -X POST -F username=bob -F password=bob-pass-1 $N/api/v1/auth/login)"
check "node knows go's session" bob "$(curl -s -b $S/jar-bob $N/api/v1/users/current | json username)"
check "bob can't read alice's state through go" 404 "$(code -b $S/jar-bob "$G/api/v1/files/$STATE_FILE")"
check "bob can't read alice's game through go" 404 "$(code -b $S/jar-bob "$G/api/v1/files/$FILE_ID")"
check "bob can't read alice's state through node" 404 "$(code -b $S/jar-bob "$N/api/v1/files/$STATE_FILE")"

echo "# Logging out through Go ends the session for Node too"
check "go logout" 302 "$(code -b $S/jar-g -H 'Sec-Fetch-Site: same-origin' $G/logout)"
check "node no longer knows that session" "" "$(curl -s -b $S/jar-g $N/api/v1/users/current)"

echo "# The database is as Node expects"
check "integrity" ok "$(sqlite3 $DB 'pragma integrity_check')"
check "migrations recorded once" "$(ls "$(dirname "$0")/../../src/databases/migrations/"*.sql | wc -l | tr -d ' ')" \
  "$(sqlite3 $DB 'select count(*) from __drizzle_migrations')"
check "timestamps are milliseconds" 0 "$(sqlite3 $DB "select count(*) from (select created_at c from users union all
  select updated_at from users union all select expires_at from sessions union all select last_activity_at from sessions
  union all select created_at from sessions) where typeof(c) != 'integer' or c < 1700000000000")"
check "ids are 10 characters" 0 "$(sqlite3 $DB "select count(*) from (select id from users union all select id from sessions
  union all select token from sessions) where length(id) != 10")"
check "node still serves its pages" 200 "$(code -b $S/jar-n "$N/api/v1/pages/library/home")"
exit $fail
