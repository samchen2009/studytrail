#!/bin/bash
# First installation on macOS; requires only tools shipped with macOS.
set -euo pipefail

install_dir="${HOME}/Applications/StudyTrail"
no_start=0
skip_tandix=0
repair_tandix=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-dir) [ "$#" -ge 2 ] || { echo 'Missing --install-dir value' >&2; exit 1; }; install_dir="$2"; shift 2 ;;
    --no-start) no_start=1; shift ;;
    --skip-tandix) skip_tandix=1; shift ;;
    --repair-tandix) repair_tandix=1; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done
[ "$skip_tandix" -eq 0 ] || [ "$repair_tandix" -eq 0 ] || { echo '--skip-tandix and --repair-tandix cannot be combined' >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || { echo 'This installer supports macOS. See README for other systems.' >&2; exit 1; }
case "$install_dir" in /*) ;; *) install_dir="$PWD/$install_dir" ;; esac
install_dir="${install_dir%/}"
[ -n "$install_dir" ] || { echo 'Invalid installation directory' >&2; exit 1; }
mkdir -p "$(dirname "$install_dir")"
# Resolve the parent so launchers also work when installed through a symlink.
install_dir="$(cd "$(dirname "$install_dir")" && pwd -P)/$(basename "$install_dir")"
lock_dir="${install_dir}.install-lock"
mkdir "$lock_dir" 2>/dev/null || { echo "Another installation is running, or a stale lock remains: $lock_dir" >&2; exit 1; }
stage=''
cleanup() {
  [ -z "$stage" ] || rm -rf "$stage"
  rmdir "$lock_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
download() { curl --fail --location --retry 3 --connect-timeout 20 --output "$2" "$1"; }

if [ -e "$install_dir" ]; then
  if [ ! -f "$install_dir/.studytrail-installer-v1" ] || [ ! -x "$install_dir/runtime/bin/node" ] || [ ! -f "$install_dir/app/scripts/dev.cjs" ] || [ ! -f "$install_dir/Start StudyTrail.command" ]; then
    echo "Installation directory is not a complete installer-managed installation: $install_dir" >&2
    echo 'Choose another directory with --install-dir. Existing files have been preserved.' >&2
    exit 1
  fi
  echo "StudyTrail is already installed: $install_dir (reusing it; no upgrade)."
else
  stage="$(mktemp -d "$(dirname "$install_dir")/.studytrail-install.XXXXXX")"
  bundle="$stage/bundle"
  mkdir -p "$bundle/runtime"
  arch="$(uname -m)"
  # A translated Terminal on Apple Silicon can report x86_64.
  if [ "$arch" = x86_64 ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
  case "$arch" in arm64) ;; x86_64) arch=x64 ;; *) echo "Unsupported architecture: $arch" >&2; exit 1 ;; esac
  echo 'Downloading a private Node.js 24 LTS runtime from nodejs.org...'
  download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' "$stage/SHASUMS256.txt"
  archive="$(awk -v suffix="-darwin-${arch}.tar.gz" '$2 ~ /^node-v24\./ && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$stage/SHASUMS256.txt")"
  case "$archive" in ''|*[!a-zA-Z0-9.-]*) echo 'Invalid Node.js download manifest' >&2; exit 1 ;; esac
  expected="$(awk -v name="$archive" '$2==name {print $1}' "$stage/SHASUMS256.txt")"
  [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || { echo 'Invalid Node.js checksum' >&2; exit 1; }
  version="${archive#node-}"; version="${version%-darwin-*}"
  download "https://nodejs.org/dist/$version/$archive" "$stage/$archive"
  actual="$(shasum -a 256 "$stage/$archive" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || { echo 'Node.js SHA-256 verification failed' >&2; exit 1; }
  tar -xzf "$stage/$archive" -C "$bundle/runtime" --strip-components=1
  "$bundle/runtime/bin/node" --version

  echo 'Downloading StudyTrail...'
  download 'https://github.com/samchen2009/studytrail/archive/refs/heads/main.zip' "$stage/project.zip"
  unzip -q "$stage/project.zip" -d "$stage/source"
  mv "$stage/source/studytrail-main" "$bundle/app"
  [ -f "$bundle/app/scripts/dev.cjs" ] && [ -f "$bundle/app/package-lock.json" ] || { echo 'Incomplete project archive' >&2; exit 1; }
  echo 'Installing application dependencies...'
  (cd "$bundle/app" && "$bundle/runtime/bin/node" "$bundle/runtime/lib/node_modules/npm/bin/npm-cli.js" ci --include=optional --ignore-scripts --no-audit --no-fund)
  cat > "$bundle/Start StudyTrail.command" <<'LAUNCHER'
#!/bin/bash
root="$(cd "$(dirname "$0")" && pwd -P)"
cd "$root/app" || exit 1
echo 'StudyTrail: http://127.0.0.1:8767/ (Ctrl+C to stop)'
"$root/runtime/bin/node" scripts/dev.cjs --data-dir "$root/data" "$@"
status=$?
if [ "$status" -ne 0 ]; then read -r -p 'Startup failed. Press Enter to close...' _; fi
exit "$status"
LAUNCHER
  chmod +x "$bundle/Start StudyTrail.command"
  printf 'StudyTrail installer v1\nNode: %s\nSource: samchen2009/studytrail main\n' "$version" > "$bundle/.studytrail-installer-v1"
  mv "$bundle" "$install_dir"
fi

echo "StudyTrail installed: $install_dir"
if [ "$skip_tandix" = 1 ]; then
  echo 'Tandix setup was explicitly skipped. AI grading is not ready.'
elif [ -f "$install_dir/.tandix-setup-v1" ] && [ "$repair_tandix" = 0 ]; then
  echo 'Tandix setup previously completed. To reinstall or repair it, use --repair-tandix.'
else
  [ -n "$stage" ] || stage="$(mktemp -d "$(dirname "$install_dir")/.studytrail-install.XXXXXX")"
  echo 'Installing Tandix using its official macOS wizard (Chrome extension loading requires your interaction).'
  echo 'If setup is interrupted, StudyTrail is preserved. Rerun this installer to retry Tandix.'
  rm -f "$install_dir/.tandix-setup-v1"
  (
    # Paths must refer to the final runtime location: Tandix saves them for future launches.
    export PATH="$install_dir/runtime/bin:$install_dir/tools/bin:$PATH"
    if ! open -Ra 'Google Chrome' >/dev/null 2>&1; then
      echo 'Google Chrome is required. Opening its official download page...'
      open 'https://www.google.com/chrome/'
      read -r -p 'Install Google Chrome, then press Enter to continue: ' _
      open -Ra 'Google Chrome' >/dev/null 2>&1 || { echo 'Google Chrome is still missing. Install it and rerun this command.' >&2; exit 1; }
    fi
    # Reuse Codex from PATH, a desktop app, or an explicit hint using Tandix's own discovery.
    download 'https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/runtime/runtime-discovery.mjs' "$stage/runtime-discovery.mjs"
    codex_path="$(node --input-type=module -e 'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.argv[1])); process.stdout.write(m.findCodex()||"");' "$stage/runtime-discovery.mjs")"
    if [ -z "$codex_path" ]; then
      echo 'Installing a private Codex CLI for AI grading...'
      node "$install_dir/runtime/lib/node_modules/npm/bin/npm-cli.js" install --global --prefix "$install_dir/tools" --no-audit --no-fund @openai/codex
      codex_path="$install_dir/tools/bin/codex"
    fi
    export CODEX_CLI_PATH="$codex_path"
    "$codex_path" --version
    if ! "$codex_path" login status >/dev/null 2>&1; then
      echo 'Complete Codex sign-in in your browser. Your credentials stay with Codex.'
      "$codex_path" login
      "$codex_path" login status >/dev/null 2>&1 || { echo 'Codex sign-in is incomplete; rerun this installer after signing in.' >&2; exit 1; }
    fi
    download 'https://raw.githubusercontent.com/samchen2009/tandix/main/scripts/install/macos.sh' "$stage/tandix-macos.sh"
    /bin/bash "$stage/tandix-macos.sh"
  )
  printf 'Official Tandix macOS wizard completed.\n' > "$install_dir/.tandix-setup-v1"
  echo 'Tandix extension files and native companion installed. Reload the extension in Chrome.'
fi
echo "Next time, double-click: $install_dir/Start StudyTrail.command"
echo "Data and complete backups: $install_dir/data"
echo 'For AI grading, select Codex in Tandix, then authorize this StudyTrail site on first use.'
cleanup
stage=''
trap - EXIT INT TERM
if [ "$no_start" = 0 ]; then exec /bin/bash "$install_dir/Start StudyTrail.command"; fi
