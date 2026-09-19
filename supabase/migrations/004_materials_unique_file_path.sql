-- 004_materials_unique_file_path.sql
-- Already APPLIED to production project vxsphvrvulhbyhqmoeex on 2026-09-18.
-- Kept in the repo so a fresh Supabase project reproduces the same schema.
--
-- Enforce one materials row per storage object so seeding / upload retries
-- cannot create duplicates (v1.7.0 had to clean these up by hand).
--
-- Pre-flight (production, 2026-09-18): 0 duplicate file_path, 0 NULL file_path
-- across 139 rows, so the index applies without data loss.
--
-- Idempotent (IF NOT EXISTS).  Reversible:  DROP INDEX public.uq_materials_file_path;
create unique index if not exists uq_materials_file_path
  on public.materials (file_path)
  where file_path is not null;
