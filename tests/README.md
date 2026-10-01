# Tests

Two kinds:

- **Node tests** (`*.test.mjs` in the repo root) for the pure modules — the
  Wrapped engine, activities, seasons, trips, the journey maths. No browser.

      node --test *.test.mjs

- **Browser tests** (`tests/*.mjs`) that boot the real `index.html` in headless
  Chromium against `fb-live.mjs`, a Firebase stand-in that actually stores
  what the app writes and fires listeners again, so a log typed into the form
  goes all the way round.

      sh tests/setup.sh                    # once: real Tailwind + Leaflet
      python3 -m http.server 8899 &        # from the repo root
      node tests/smoke.mjs
      for t in tests/[a-z]*.mjs; do case $t in *boot*|*fb-live*) ;; *) node $t || echo "FAILED $t";; esac; done

  Each prints its checks and exits non-zero on a failure. Screenshots go to
  `tests/.out/` (ignored by git).

`boot.mjs` holds the shared setup: a fixed clock, a fixture of logs, and every
CDN answered locally. Without `setup.sh` the tests still run — Tailwind falls
back to `.hidden` only and Leaflet to a do-nothing fake — but screenshots won't
look like the phone.

None of this is cached by the service worker or loaded by the app.
