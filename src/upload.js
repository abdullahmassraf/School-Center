// ============================================================================
// src/upload.js — Document Upload & AI Ingestion Pipeline
// ============================================================================

import { 
  getSupabase, 
  isSupabaseConfigured, 
  uploadCourseFile, 
  insertMaterialRecord, 
  triggerDocumentProcessing,
  subscribeToMaterials 
} from './supabase.js';
import { getCurrentAiUser } from './ai-history.js';

let activeSubscription = null;

export function setupRealtimeListener(onStatusUpdate) {
  if (activeSubscription) return;
  activeSubscription = subscribeToMaterials((payload) => {
    if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
      const record = payload.new;
      if (record && onStatusUpdate) {
        onStatusUpdate(record);
      }
    }
  });
}

/**
 * Ensures a course has at least one module to attach materials to.
 * Returns the module ID.
 */
async function getOrCreateDefaultModule(courseId) {
  const sb = getSupabase();
  if (!sb) return null;

  // Check for existing modules
  const { data: existingModules, error: fetchErr } = await sb
    .from('modules')
    .select('id, title')
    .eq('course_id', courseId)
    .order('order_index', { ascending: true })
    .limit(1);

  if (!fetchErr && existingModules && existingModules.length > 0) {
    return existingModules[0].id;
  }

  // Create a default module
  const { data: newModule, error: insertErr } = await sb
    .from('modules')
    .insert([
      {
        course_id: courseId,
        title: 'Course Documents & Materials',
        order_index: 0
      }
    ])
    .select('id')
    .single();

  if (insertErr) {
    throw new Error(`Failed to create module for course: ${insertErr.message}`);
  }
  return newModule.id;
}

/**
 * Processes a single uploaded file through the Supabase pipeline:
 * 1. Uploads to Supabase Storage ('course-materials')
 * 2. Creates record in 'materials' table with status 'pending'
 * 3. Triggers Edge Function 'process-document'
 * 4. Listens for Realtime updates or polls status until 'completed'
 */
export async function uploadAndProcessFile({ file, course, onProgress, onLog }) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase credentials are not configured. Please set them in Settings or .env.');
  }

  const sb = getSupabase();

  // v1.5.2 RLS: course-content writes require a signed-in session. Without
  // this check an anonymous visitor gets a raw Storage 403; with it they get
  // an actionable message pointing at the sign-in that actually unblocks them.
  const currentUser = await getCurrentAiUser();
  if (!currentUser) {
    throw new Error('Uploading course files requires signing in first (Settings → Account & cross-device sync). This keeps the course library writable only by its owner.');  }

  onLog(`Uploading "${file.name}" to Cloud Storage...`);
  onProgress({ status: 'uploading', text: 'Uploading to Storage...' });

  // 1. Upload to Storage
  const { filePath, publicUrl } = await uploadCourseFile(course.code, file);
  onLog(`✓ File stored at ${filePath}`);

  // 2. Resolve Module ID
  onLog(`Resolving course module...`);
  const moduleId = await getOrCreateDefaultModule(course.dbId || course.id);

  // 3. Insert Materials row
  onLog(`Creating database record...`);
  let materialType = 'lecture';
  const lowerName = file.name.toLowerCase();
  if (lowerName.includes('worksheet') || lowerName.includes('tutorial') || lowerName.includes('problem')) {
    materialType = 'worksheet';
  } else if (lowerName.includes('syllabus') || lowerName.includes('outline')) {
    materialType = 'syllabus';
  } else if (lowerName.includes('assignment') || lowerName.includes('project')) {
    materialType = 'assignment';
  }

  const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

  const materialRecord = await insertMaterialRecord({
    moduleId,
    title: cleanTitle,
    type: materialType,
    filePath,
    fileUrl: publicUrl
  });

  onLog(`✓ Material ID ${materialRecord.id} recorded with status 'pending'.`);
  onProgress({ status: 'pending', text: 'Queueing for AI extraction...' });

  // 4. Trigger Edge Function
  onLog(`Invoking Gemini document intelligence...`);
  onProgress({ status: 'processing', text: 'Gemini AI parsing document...' });

  let processorStarted = false;
  try {
    await triggerDocumentProcessing(materialRecord.id, filePath);
    processorStarted = true;
  } catch (fnErr) {
    // Storage is already complete and the material record is valid. The
    // optional AI processor is not required for viewing/downloading a file.
    // Mark it available instead of trapping the upload in a 120-second
    // "pending" state when the processor function is unavailable.
    onLog(`Document processor unavailable; keeping uploaded file available: ${fnErr.message || fnErr}`);
    try {
      await sb.from('materials').update({
        status: 'completed',
        content_json: {
          source: 'course-material-upload',
          processing: 'unavailable',
          note: 'Original file is available in Supabase Storage. AI can analyze a fresh attachment directly in the AI workspace.'
        },
        error_message: null,
        updated_at: new Date().toISOString()
      }).eq('id', materialRecord.id);
    } catch (availabilityErr) {
      onLog(`Could not mark uploaded file available: ${availabilityErr.message || availabilityErr}`);
    }
  }

  // 5. If no processor is installed, the file is already ready to view.
  // Return immediately rather than polling a permanently pending record.
  if (!processorStarted) {
    const { data: available } = await sb.from('materials').select('*').eq('id', materialRecord.id).single();
    onProgress({ status: 'completed', text: 'Uploaded & ready to view ✓', data: available || materialRecord });
    return available || materialRecord;
  }

  // 6. Wait for an installed processor with timeout & polling fallback
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 60; // 60 * 2s = 120s timeout

    const checkInterval = setInterval(async () => {
      attempts++;
      try {
        const { data, error } = await sb
          .from('materials')
          .select('*')
          .eq('id', materialRecord.id)
          .single();

        if (error) {
          clearInterval(checkInterval);
          reject(error);
          return;
        }

        if (data.status === 'completed') {
          clearInterval(checkInterval);
          onLog(`✓ AI processing completed for "${file.name}"!`);
          onProgress({ status: 'completed', text: 'Processed & Indexed ✓', data });
          resolve(data);
          return;
        } else if (data.status === 'error') {
          clearInterval(checkInterval);
          onLog(`✗ Processing error: ${data.error_message || 'Unknown error'}`);
          onProgress({ status: 'error', text: data.error_message || 'Processing failed', data });
          reject(new Error(data.error_message || 'AI processing failed'));
          return;
        } else {
          onProgress({ status: data.status, text: 'Analyzing document contents...' });
        }

        if (attempts >= maxAttempts) {
          clearInterval(checkInterval);
          onLog(`Processing timed out for "${file.name}". It may still complete in background.`);
          resolve(data);
        }
      } catch (pollErr) {
        clearInterval(checkInterval);
        reject(pollErr);
      }
    }, 2000);
  });
}
