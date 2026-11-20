#!/bin/sh
# Starts the server as an ordinary user (PUID and PGID, 1000 by default) rather than as root, so a flaw in it can't act
# with root's rights in the container or on the folders mounted into it. PUID=0 keeps running as root.
#
# Earlier images ran as root, so what they wrote is owned by root. Those files, and only those, in the data folder and
# in the folders the settings name, are handed to the user: files owned by anyone else, such as a game collection
# mounted from the host, are left as they are.
set -eu

uid="${PUID:-1000}"
gid="${PGID:-1000}"

if [ "$(id -u)" != 0 ] || [ "$uid" = 0 ]; then
  exec "$@"
fi

if ! getent group "$gid" >/dev/null; then
  addgroup -g "$gid" retroassembly
fi
if ! getent passwd "$uid" >/dev/null; then
  adduser -D -H -h /app -u "$uid" -G "$(getent group "$gid" | cut -d: -f1)" retroassembly
fi

# The data folder, and every folder a *_DIR or *_DIRECTORY setting names, but for the app's own read-only files
folders="${DATA_DIR:-${RETROASSEMBLY_RUN_TIME_DATA_DIRECTORY:-/app/data}}"
mkdir -p "$folders"
for setting in $(env | grep -E '^[A-Z_]+_(DIR|DIRECTORY)=' | cut -d= -f1); do
  case "$setting" in
    CLIENT_DIR | MIGRATIONS_DIR | RETROASSEMBLY_GO_CLIENT_ROOT | RETROASSEMBLY_GO_MIGRATIONS_DIRECTORY) continue ;;
  esac
  folders="$folders
$(printenv "$setting")"
done

echo "$folders" | while IFS= read -r folder; do
  case "$folder" in
    /*) ;;
    *) folder="/app/$folder" ;;
  esac
  if [ -d "$folder" ]; then
    find "$folder" -user 0 -exec chown "$uid:$gid" {} +
  fi
done

exec su-exec "$uid:$gid" "$@"
