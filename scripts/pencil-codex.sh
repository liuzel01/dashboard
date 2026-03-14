#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pen_file="$repo_root/dashboard.pen"
frontend_dir="$repo_root/eks-dashboard-frontend"
app_file="$frontend_dir/src/App.tsx"

has_rg=0
if command -v rg >/dev/null 2>&1; then
  has_rg=1
fi

usage() {
  cat <<'USAGE'
Usage: scripts/pencil-codex.sh <command>

Commands:
  status   Show repo + design file status
  pages    List frontend pages
  routes   Extract routes from App.tsx
  help     Show this help
USAGE
}

cmd="${1:-help}"
case "$cmd" in
  status)
    echo "Repo: $repo_root"
    if [[ -f "$pen_file" ]]; then
      echo "Pencil file: $pen_file"
    else
      echo "Pencil file missing: $pen_file"
    fi
    if [[ -f "$app_file" ]]; then
      echo "Frontend entry: $app_file"
    else
      echo "Frontend entry missing: $app_file"
    fi
    ;;
  pages)
    if [[ -d "$frontend_dir/src/pages" ]]; then
      ls "$frontend_dir/src/pages" | sort
    else
      echo "Missing: $frontend_dir/src/pages"
    fi
    ;;
  routes)
    if [[ -f "$app_file" ]]; then
      if [[ $has_rg -eq 1 ]]; then
        rg "<Route" "$app_file" -n
      else
        grep -n "<Route" "$app_file" || true
      fi
    else
      echo "Missing: $app_file"
    fi
    ;;
  help|*)
    usage
    ;;
esac
