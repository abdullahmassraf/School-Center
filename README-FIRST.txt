SCHOOL CENTER — FULL BUILD

This ZIP contains the complete School Center project, including the latest:
- iOS-style glass UI
- unified AI + Search section
- icon-only bottom navigation
- Settings with sync/account/appearance/Gemini configuration
- deletable notes
- voice/transcription workspace
- cross-device AI chat history via Supabase
- inline image/video/audio chat attachments
- ENGR 43301D assignment routing

GITHUB DEPLOYMENT
1. Upload/replace the project files in your GitHub repository.
2. Do NOT upload .env files or private API keys.
3. GitHub Pages should serve index.html from the repository root.

SUPABASE
1. Open Supabase → SQL Editor.
2. Open supabase/schema-ai.sql from this ZIP and paste ONLY its SQL contents into the SQL Editor.
3. Run it.
4. Open supabase/migrations/002_user_notes_assignments.sql and run its SQL contents too — this
   is new in this build and is what makes Notes/Assignments actually sync across devices
   (previously they were localStorage-only, even though the buttons suggested otherwise).
5. Deploy supabase/functions/gemini-live-token/index.ts as an Edge Function named gemini-live-token.
6. In Edge Function Secrets, add GEMINI_API_KEY with your private Gemini API key.
7. In the School Center Settings page, configure the Supabase Project URL and Publishable/Anon key.
8. Use the same email on each device for the AI history magic-link account — this same account
   now also carries Notes and Assignments, not just AI chat.

REQUIRED — FIX THE "localhost refused to connect" EMAIL LINK
This is a Supabase Dashboard setting, not something in this ZIP:
1. Supabase Dashboard → Authentication → URL Configuration.
2. Set "Site URL" to your live GitHub Pages URL (e.g. https://abdullahmassraf.github.io/School-Center/).
3. Under "Redirect URLs", add that same URL (and the same URL with a trailing /* if the field
   supports wildcards).
4. Save. Existing unconfirmed sign-in emails were sent before this fix and will still point to
   localhost — send yourself a fresh sign-in link from Settings after saving this.

See POLISH-CHANGELOG.md for the full list of what changed in this pass and why.

SECURITY
- Do not commit .env files.
- Do not put a Gemini secret key into GitHub.
- The browser may use the Supabase publishable/anon key with RLS enabled.

AUTOMATIC NOTES & ASSIGNMENTS SYNC
=================================
After updating the code, run `supabase/migrations/002_user_notes_assignments.sql` once in Supabase SQL Editor.
This version also adds the `deleted_at` column used to make deletions sync across devices and persist as cloud tombstones.
You do not need to press Push to Cloud or Sync from Cloud during normal use. Once signed in on each device with the same Supabase account, Notes and Assignments sync automatically.

