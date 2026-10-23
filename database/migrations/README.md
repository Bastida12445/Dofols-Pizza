# Database migration process

`../schema.sql` is the current full schema for a new project. Existing installations that already ran the earlier schema should apply `0002_paymongo_and_route_delivery.sql` after taking a backup. Keep later database changes as consecutively numbered files here.

For each migration:

1. Make the smallest change that can be applied safely. Prefer additive columns/tables first; avoid dropping data.
2. Include a short comment at the top stating the purpose and whether it is safe to rerun.
3. Review the affected API routes and SQL functions alongside the migration.
4. Back up the Supabase project and apply the migration to a separate staging project first.
5. Verify table columns, indexes, constraints, RLS, grants, and affected API behavior in staging.
6. Apply the same numbered file in production through **Supabase Dashboard → SQL Editor** and record that it ran. Do not paste secret credentials into the migration.

The SQL Editor keeps the hosted database in Supabase; no local PostgreSQL or Docker is needed. Do not edit a migration after it has been applied in production. Add a new migration to correct it.
