-- ============================================================================
-- 001_initial_schema.sql
-- Full Schema for School Center Platform
-- Courses, Modules, Materials + Storage Bucket + RLS + Realtime
-- ============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. COURSES TABLE
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    instructor TEXT,
    schedule TEXT,
    room TEXT,
    color TEXT DEFAULT '#8B7CF6',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 3. MODULES TABLE
CREATE TABLE IF NOT EXISTS public.modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    order_index INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 4. MATERIALS TABLE
CREATE TABLE IF NOT EXISTS public.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'other' CHECK (type IN ('lecture', 'worksheet', 'syllabus', 'assignment', 'other')),
    file_path TEXT,
    file_url TEXT,
    content_json JSONB,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
    error_message TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 5. INDEXES
CREATE INDEX IF NOT EXISTS idx_modules_course_id ON public.modules(course_id);
CREATE INDEX IF NOT EXISTS idx_materials_module_id ON public.materials(module_id);
CREATE INDEX IF NOT EXISTS idx_materials_status ON public.materials(status);
CREATE INDEX IF NOT EXISTS idx_materials_content_json ON public.materials USING gin (content_json);

-- 6. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_materials_updated_at ON public.materials;
CREATE TRIGGER set_materials_updated_at
    BEFORE UPDATE ON public.materials
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- 7. ENABLE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

-- 8. RLS POLICIES
-- Courses: public read, allow insert/update for anon & authenticated
DROP POLICY IF EXISTS "Allow public read on courses" ON public.courses;
CREATE POLICY "Allow public read on courses"
    ON public.courses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert on courses" ON public.courses;
CREATE POLICY "Allow insert on courses"
    ON public.courses FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update on courses" ON public.courses;
CREATE POLICY "Allow update on courses"
    ON public.courses FOR UPDATE USING (true) WITH CHECK (true);

-- Modules: public read, allow insert/update for anon & authenticated
DROP POLICY IF EXISTS "Allow public read on modules" ON public.modules;
CREATE POLICY "Allow public read on modules"
    ON public.modules FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert on modules" ON public.modules;
CREATE POLICY "Allow insert on modules"
    ON public.modules FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update on modules" ON public.modules;
CREATE POLICY "Allow update on modules"
    ON public.modules FOR UPDATE USING (true) WITH CHECK (true);

-- Materials: public read, allow insert/update for anon & authenticated
DROP POLICY IF EXISTS "Allow public read on materials" ON public.materials;
CREATE POLICY "Allow public read on materials"
    ON public.materials FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert on materials" ON public.materials;
CREATE POLICY "Allow insert on materials"
    ON public.materials FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update on materials" ON public.materials;
CREATE POLICY "Allow update on materials"
    ON public.materials FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete on materials" ON public.materials;
CREATE POLICY "Allow delete on materials"
    ON public.materials FOR DELETE USING (true);

-- 9. ENABLE REALTIME ON TABLES
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'materials'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.materials;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'courses'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.courses;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND tablename = 'modules'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.modules;
    END IF;
END $$;

-- 10. STORAGE BUCKET CREATION & POLICIES
INSERT INTO storage.buckets (id, name, public)
VALUES ('course-materials', 'course-materials', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public access to course-materials bucket" ON storage.objects;
CREATE POLICY "Public access to course-materials bucket"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "Allow uploads to course-materials bucket" ON storage.objects;
CREATE POLICY "Allow uploads to course-materials bucket"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "Allow updates to course-materials bucket" ON storage.objects;
CREATE POLICY "Allow updates to course-materials bucket"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'course-materials');

DROP POLICY IF EXISTS "Allow deletes in course-materials bucket" ON storage.objects;
CREATE POLICY "Allow deletes in course-materials bucket"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'course-materials');
