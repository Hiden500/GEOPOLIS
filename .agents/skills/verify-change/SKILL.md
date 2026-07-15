---
name: verify-change
description: Typecheck + test the workspace(s) touched by the current change before commit.
---
1. Determine touched workspace(s): client/ and/or server/.
2. client: `cd client && npx tsc --noEmit -p tsconfig.app.json && npm test`
3. server: `cd server && npx tsc --noEmit -p tsconfig.json && npm test`
4. Report failures errors-first (use `repowise distill` on the output). Never commit on red.
