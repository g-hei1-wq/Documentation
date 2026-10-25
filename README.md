# Racing Protocols

Public, cross-device change documentation using Supabase Auth, Postgres row-level security, private Supabase Storage, and GitHub Pages.

## Connect the backend

1. Create a Supabase project.
2. Run all of `supabase-schema.sql` in the Supabase SQL Editor.
3. Deploy `supabase/functions/manage-users/index.ts` as the `manage-users` Edge Function. With the Supabase CLI, link this project, then run `supabase functions deploy manage-users --no-verify-jwt`. The public first-run request is protected by a private activation code and a one-time database lock; all other function actions verify the caller's session and admin role in code. The function uses Supabase's server-side service-role environment variable; never put that key in this repository.
4. In Supabase **Edge Functions → Secrets**, create `RP_SETUP_CODE` with a randomly generated secret of at least 24 characters. Keep it private; you will enter it once in the site's activation form.
5. Set `url` and `anonKey` in `supabase-config.js` to the project's Project URL and publishable/anon key. Those client values are public; database policies enforce access.
6. In Supabase Auth URL settings, set the site URL and allowed redirect URL to `https://g-hei1-wq.github.io/Documentation/`.
7. Open the public site, select **Initial system activation**, and create the first administrator using a new password. The activation code is checked server-side, and the database atomically permits only one initial administrator. The activation control disappears after setup.

After pushing the configured files to `main`, GitHub Actions deploys the site. Until a Supabase project is connected, the login and activation controls remain disabled.

## Upload limits

Descriptions are checked at 1000 words in the browser and database. The schema and upload UI allow files up to 500 MB each and use resumable uploads. Supabase project-level storage limits and plan limits also apply; configure the project for 500 MB objects before accepting large files.

## Access model

Members can create records and view their own or explicitly shared records. Administrators can view all records, create accounts, assign admin roles, change passwords, and manage record sharing. Access policies are enforced in Postgres and private Storage, not by hiding interface controls. Do not commit real credentials or service-role keys.
