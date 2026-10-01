#!/bin/sh
# One-off: real Tailwind and Leaflet for the browser tests, so screenshots look
# like the phone. Everything lands in tests/.deps, which git ignores.
set -e
cd "$(dirname "$0")"
mkdir -p .deps
cd .deps
[ -f package.json ] || echo '{"private":true}' > package.json
npm install --silent tailwindcss@3.4.17 leaflet@1.9.4
# The app uses the Tailwind Play CDN, which builds classes in the browser. Build
# the same thing ahead of time from every file that can name a class.
printf '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n' > in.css
npx tailwindcss -i in.css -o tailwind.css --content '../../index.html,../../*.js' 2>/dev/null
echo "tests/.deps ready"
