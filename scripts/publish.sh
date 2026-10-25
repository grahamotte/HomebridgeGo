#!/usr/bin/env bash
# Publishes each named plugin, or every plugin, whose package.json version is not on npm yet.
# npm opens its browser login and passkey prompts inline, so run this from a terminal.
set -euo pipefail
cd "$(dirname "$0")/.."

packages=("$@")
if [ ${#packages[@]} -eq 0 ]; then
  packages=(lutron venstar wac yale)
fi

pending=()
for package in "${packages[@]}"; do
  if [ ! -f "packages/${package}/package.json" ]; then
    echo "Unknown package: ${package}" >&2
    exit 1
  fi

  spec="$(node -p "const p = require('./packages/${package}/package.json'); p.name + '@' + p.version")"
  if npm view "${spec}" version > /dev/null 2>&1; then
    echo "${spec} is already on npm."
  else
    pending+=("${package}")
  fi
done

if [ ${#pending[@]} -eq 0 ]; then
  echo "Nothing to publish."
  exit 0
fi

npm run validate
if ! npm whoami > /dev/null 2>&1; then
  npm login --auth-type=web
fi

for package in "${pending[@]}"; do
  echo "Publishing packages/${package} as $(npm whoami)"
  npm publish --workspace "packages/${package}" --auth-type=web
done
