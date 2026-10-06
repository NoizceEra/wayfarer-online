# Relay image for Railway.
#
# Why a Dockerfile instead of the auto-detected Railpack build:
#  - Railpack runs the ROOT package.json install + start, so it tried to install
#    the client's deps (whose lock is version-sensitive) and then booted
#    `vite preview` instead of the relay.
#  - Railpack also ignores railway.json's builder/buildCommand/startCommand.
# A Dockerfile is auto-detected at the repo root and lets us build exactly the
# relay: server deps only, on a Node whose ABI has a better-sqlite3 prebuild
# (Node 22 = ABI 127), so no compiler is needed and there is no apt layer to fail.
FROM node:22-slim

WORKDIR /app

# Copy everything: the relay also imports ../../src/data/guilds.cjs and
# ../src/data/seasons.js, so src/ must be present (its node_modules are not needed).
COPY . .

# Only the relay's deps — the root lockfile is never consulted here.
RUN npm ci --prefix server --omit=dev

ENV NODE_ENV=production \
    DATA_DIR=/data
VOLUME ["/data"]

# PORT is injected by Railway; server/config.js reads it.
CMD ["node", "server/index.js"]
