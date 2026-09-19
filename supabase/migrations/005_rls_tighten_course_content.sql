-- ============================================================================
-- 005_rls_tighten_course_content.sql
-- Minimum secure RLS model (v1.5.2 security audit, empirical probe findings):
--
--   BEFORE: courses/modules/materials had USING(true) on SELECT, INSERT,
--   UPDATE and materials also DELETE for role `public`. The course-materials
--   Storage bucket likewise allowed anonymous writes.
--   scripts/rls-audit.mjs empirically confirmed an anonymous visitor with the
--   public site key could: INSERT materials, UPDATE materials, DELETE all
--   materials, and UPLOAD files into any course folder.
--
--   AFTER (minimum model that supports the app's real architecture):
--     - courses / modules / materials: public SELECT (public study site)
--     - writes on course content: authenticated users only
--       (the app's upload flow runs in the browser of a signed-in user;
--        seeding/admin scripts use the service-role key, which bypasses RLS)
--     - user_notes / user_assignments: unchanged (auth.uid() = user_id)
--     - storage: public SELECT, authenticated INSERT/UPDATE/DELETE
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. courses: public read, authenticated write
-- ---------------------------------------------------------------------------
drop policy if exists "Allow insert on courses" on public.courses;
create policy "Allow insert on courses"
    on public.courses for insert
    to authenticated
    with check (true);

drop policy if exists "Allow update on courses" on public.courses;
create policy "Allow update on courses"
    on public.courses for update
    to authenticated
    using (true)
    with check (true);

-- ---------------------------------------------------------------------------
-- 2. modules: public read, authenticated write
-- ---------------------------------------------------------------------------
drop policy if exists "Allow insert on modules" on public.modules;
create policy "Allow insert on modules"
    on public.modules for insert
    to authenticated
    with check (true);

drop policy if exists "Allow update on modules" on public.modules;
create policy "Allow update on modules"
    on public.modules for update
    to authenticated
    using (true)
    with check (true);

-- ---------------------------------------------------------------------------
-- 3. materials: public read, authenticated write (incl. delete)
-- ---------------------------------------------------------------------------
drop policy if exists "Allow insert on materials" on public.materials;
create policy "Allow insert on materials"
    on public.materials for insert
    to authenticated
    with check (true);

drop policy if exists "Allow update on materials" on public.materials;
create policy "Allow update on materials"
    on public.materials for update
    to authenticated
    using (true)
    with check (true);

drop policy if exists "Allow delete on materials" on public.materials;
create policy "Allow delete on materials"
    on public.materials for delete
    to authenticated
    using (true);

-- ---------------------------------------------------------------------------
-- 4. Storage: course-materials bucket
--    Public read stays (file URLs are public); writes require a session.
-- ---------------------------------------------------------------------------
drop policy if exists "Allow public read on course materials" on storage.objects;
create policy "Allow public read on course materials"
    on storage.objects for select
    to public
    using (bucket_id = 'course-materials');

drop policy if exists "Allow authenticated upload to course materials" on storage.objects;
create policy "Allow authenticated upload to course materials"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'course-materials');

drop policy if exists "Allow authenticated update to course materials" on storage.objects;
create policy "Allow authenticated update to course materials"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'course-materials')
    with check (bucket_id = 'course-materials');

drop policy if exists "Allow authenticated delete from course materials" on storage.objects;
create policy "Allow authenticated delete from course materials"
    on storage.objects for delete
    to authenticated
    using (bucket_id = 'course-materials');
