# Racing Protocols

Public, cross-device change documentation using Supabase Auth, Postgres row-level security, private Supabase Storage, and GitHub Pages.

## Connect the backend

1. Create a Supabase project.
2. Run `supabase-schema.sql` in the Supabase SQL Editor.
3. Create the first user in Supabase Auth with a new, unique password. Do not reuse a password previously shared in chat.
4. In the SQL Editor, run the bootstrap statement at the bottom of `supabase-schema.sql`, replacing `ADMIN_EMAIL` with that Auth user's email. This grants the first administrator role.
5. Deploy the admin function from the project root with the Supabase CLI: `supabase functions deploy manage-users`. The function uses the Supabase service-role key only in Supabase's server environment; never put that key in this repository.
6. Set `url` and `anonKey` in `supabase-config.js` to the project's Project URL and publishable/anon key. Those client values are public; database policies enforce access.
7. In Supabase Auth URL settings, set the site URL and allowed redirect URL to `https://g-hei1-wq.github.io/Documentation/`.

After pushing the configured files to `main`, GitHub Actions deploys the site. The current public page remains unconfigured until a Supabase project is connected.

## Upload limits

Descriptions are checked at 1000 words in the browser and database. The schema and upload UI allow files up to 500 MB each and use resumable uploads. Supabase project-level storage limits and plan limits also apply; configure the project for 500 MB objects before accepting large files.

## Access model

Members can create records and view their own or explicitly shared records. Administrators can view all records, create accounts, assign admin roles, change passwords, and manage record sharing. Access policies are enforced in Postgres and private Storage, not by hiding interface controls. Do not commit real credentials or service-role keys.
