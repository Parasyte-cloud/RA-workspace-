#!/usr/bin/env bash
set -euo pipefail
if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install from https://brew.sh and rerun."
  exit 1
fi
brew update
brew install git gh node jq
brew install --cask visual-studio-code docker postman android-studio
npm install -g eas-cli
printf '\nRideArrivo engineering tools installed. Open Docker Desktop and Android Studio once to complete setup.\n'
