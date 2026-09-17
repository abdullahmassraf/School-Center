# 🚀 Full-Stack Dynamic School Center Platform

An automated, full-stack, cloud-persisted academic platform for **Honours B.Eng (Mechanical)** coursework. Built with vanilla glassmorphic UI, interactive canvas lava lamp, **Supabase PostgreSQL & Storage**, and automated **Google Gemini 2.0 Flash document intelligence**.

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Frontend (Client)                    │
│  index.html · src/app.js · src/supabase.js · upload.js │
│  • iPhone glassmorphism UI + interactive Lava Lamp     │
│  • KaTeX math engine for formulas & solutions          │
│  • Drag-and-drop course document upload zone           │
│  • Real-time synchronization via Supabase WebSockets   │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS (anon key)
                           ▼
┌────────────────────────────────────────────────────────┐
│                  Supabase Cloud                        │
│  • Database: courses, modules, materials tables        │
│  • Storage: 'course-materials' bucket                  │
│  • Edge Function: 'process-document' (Deno)           │
│  • Realtime CDC: Instant material status broadcast     │
└──────────────────────────┬─────────────────────────────┘
                           │ REST
                           ▼
┌────────────────────────────────────────────────────────┐
│             Google AI Studio (Gemini 2.0)              │
│  • Multimodal document ingestion (PDFs, DOCX, TXT)     │
│  • Structured JSON extraction (summary, concepts, Q&A) │
│  • Step-by-step KaTeX math solutions                   │
└────────────────────────────────────────────────────────┘
```

---

## 📦 Project Structure

```
School Center/
├── .env.example                               # Environment template
├── .gitignore                                 # Git ignore rules
├── package.json                               # Dependencies & scripts
├── index.html                                 # Clean web shell with glassmorphism CSS
├── src/
│   ├── app.js                                 # Main frontend engine & state
│   ├── supabase.js                            # Supabase client & DB service
│   ├── upload.js                              # Drag-and-drop upload & realtime pipeline
│   └── practice-studio.js                     # Linear Algebra Practice Studio (KaTeX)
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql             # DB tables, indexes, RLS & Storage policies
│   └── functions/
│       └── process-document/
│           └── index.ts                       # Gemini 2.0 Flash Deno Edge Function
├── scripts/
│   └── seed-sheridan.js                       # Automation script for Sheridan folder
├── Sheridan/                                  # Raw course directories
└── school-center-STATIC-BACKUP.html           # Original static backup
```

---

## ⚡ Quickstart Guide

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your credentials:
```ini
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...
```

> **Where to get keys:**
> - **Supabase:** [database.new](https://database.new) → Project Settings → API
> - **Google Gemini:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Free tier)

---

## 🗄️ Supabase Cloud Setup

### 1. Apply Database Schema
Go to your **Supabase Dashboard** → **SQL Editor** → create a new query, paste the contents of:
[`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)
and click **Run**.

This creates:
- `public.courses`, `public.modules`, `public.materials` tables
- Automatic `updated_at` trigger
- GIN index for search over extracted JSON
- Row Level Security (RLS) policies
- Realtime publication on `materials`, `courses`, and `modules`
- `course-materials` public Storage bucket with upload policies

### 2. Deploy Edge Function
Install the Supabase CLI and deploy the AI processing Edge function:
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase secrets set GEMINI_API_KEY=your_gemini_api_key
npx supabase functions deploy process-document
```

---

## 📂 Sheridan Automated Seeding

You can ingest the Sheridan course materials directory into Supabase Storage and database:

### Preview (Dry Run)
```bash
npm run seed:dry
```

### Live Cloud Ingestion
```bash
npm run seed
```

### Live Cloud Ingestion + Immediate AI Extraction
```bash
npm run seed:ai
```

---

## 🌐 Local Development & GitHub Pages

### Running Locally
```bash
npm start
# or: npx serve . -p 8080
```
Open [http://localhost:8080](http://localhost:8080) in your browser.

### Deploying to GitHub Pages
1. In `index.html`, set the `<meta>` tags with your public values:
   ```html
   <meta name="supabase-url" content="https://your-project.supabase.co">
   <meta name="supabase-anon-key" content="your_anon_public_key">
   ```
   *(Note: The anon key is safe to expose in client code; never expose the service role key).*
2. Push repository to GitHub.
3. In your GitHub repository: **Settings** → **Pages** → Source: **Deploy from a branch** → `main` / `/ (root)`.
4. Your dynamic School Center is live!

---

## 💡 In-App Features

1. **AI Materials & Documents Tab**: Each course view displays documents parsed by Gemini with executive summaries, key formulas, step-by-step practice questions, and download links to original files.
2. **Real-time Status Tracking**: Dropping files into the Settings upload zone transitions status badges automatically: `pending` → `processing` → `completed` without page reload.
3. **Interactive Lava Lamp**: Canvas-based metaballs with pointer attraction and customizable color palettes (Deep Violet, Crimson Load, Ultraviolet, Midnight Teal, or any custom accent).
4. **Linear Algebra Practice Studio**: KaTeX-rendered worked examples, parametric vector form computations, and eigenvalue problem sets.
