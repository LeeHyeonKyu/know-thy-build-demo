#!/usr/bin/env bash
set -euo pipefail
input=$(cat)
mkdir -p "${CLAUDE_PROJECT_DIR:-.}/.spike"
printf '%s\t%s\t%s\t%s\n' \
  "$(jq -r '.hook_event_name // "?"' <<<"$input")" \
  "$(jq -r '.tool_name // "-"' <<<"$input")" \
  "$(jq -r '(.tool_input.command // .tool_input.file_path // "-") | tostring | .[0:60]' <<<"$input")" \
  "$(jq -c 'keys' <<<"$input")" \
  >> "${CLAUDE_PROJECT_DIR:-.}/.spike/hooks.log"
exit 0
