# Field Report / Skytile development

Production source is on `main`. The existing app URL is https://zbrunomarx.github.io/USA/relatorio/. The old `skytile-demo` branch is a legacy static publication, not the development branch. Preserve uncommitted workspace files; use an isolated checkout/worktree of main when the current checkout has a different layout or unrelated work.

The authorized deployment path is `.github/workflows/deploy.yml`: validate, apply pending Supabase migrations, then publish the Pages artifact. Do not substitute a manual commit of generated files on skytile-demo for this flow. Initial owner configuration of GitHub secrets, Pages source and default branch may still be pending; inspect the current evidence and distinguish prepared automation from a verified hosted deployment.

Database changes belong in a new timestamped `supabase/migrations/*.sql` file. Published migrations, including the adoption baseline, are immutable. Never use db reset, automatic down migrations, migration repair or account/demo seeds in production deployment. The legacy deploy/supabase SQL files document the previous manual setup. Routine feature changes should not require the user to copy SQL into the dashboard.

Run npm test and npm run check:migrations. For sharing/UI changes use npm run test:ci-browser with SKYTILE_CHROMIUM set to an installed Chromium if needed. Database deployment changes also require node scripts/test-migration-cli.mjs; it uses a disposable local PostgreSQL container, never the hosted project. Regenerate setup helpers and browser SDK when their inputs change, and build the public artifact with npm run build:pages. The main Node backend remains a local alternative; Pages does not host it.

Production connection credentials belong only in GitHub's SUPABASE_DB_URL secret. Never ask for a password or private API key in chat, add private keys to the frontend, or include .env, .local, databases, real uploads, interviews or screenshots in commits/artifacts. The public Supabase publishable key is intentionally browser-visible and relies on RLS. Keep company isolation and individual roles enforced on the server/database.
