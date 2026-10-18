#!/usr/bin/env bash
# Publishes the workstation README PDFs in supabase/guides to the private
# workstation-guides bucket. Guides are read-only in the app; this is the only way
# to change one. It uses the Supabase CLI session you are already logged in with
# (no keys in this file, no keys in git).
#
#   supabase login && supabase link --project-ref fkkxcivxnwshahnbatnp   # once
#   python3 scripts/guides/build-workstation-guides.py                    # optional, rebuild PDFs
#   bash scripts/upload-workstation-guides.sh
#
# Alternative with no CLI: Supabase Dashboard > Storage > workstation-guides,
# open the <slug> folder and upload readme.pdf and readme-dark.pdf over the existing files.
set -euo pipefail
cd "$(dirname "$0")/.."
for dir in supabase/guides/*/; do
  slug="$(basename "$dir")"
  for name in readme.pdf readme-dark.pdf; do
    file="${dir}${name}"
    [ -f "$file" ] || continue
    echo "Uploading $slug/$name"
    supabase storage cp --experimental --linked "$file" "ss:///workstation-guides/${slug}/${name}"
  done
done
echo "Done. Guides are served from storage, so no redeploy is needed."
