import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
    }
    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    // Handle both direct invocation { material_id, file_path } and webhook { record: { id, file_path } }
    const material_id = body.material_id || body.record?.id;
    const file_path = body.file_path || body.record?.file_path;

    if (!material_id || !file_path) {
      return new Response(
        JSON.stringify({ error: "Missing material_id or file_path in request body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing document for material ${material_id}: ${file_path}`);

    // Mark as processing
    await supabase
      .from("materials")
      .update({ status: "processing", error_message: null })
      .eq("id", material_id);

    // Download file from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("course-materials")
      .download(file_path);

    if (downloadError || !fileData) {
      throw new Error(`Failed to download file from storage: ${downloadError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // Convert to base64
    let binary = "";
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64Data = btoa(binary);

    // Determine mime type
    const lowerPath = file_path.toLowerCase();
    let mimeType = "application/pdf";
    if (lowerPath.endsWith(".png")) mimeType = "image/png";
    else if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) mimeType = "image/jpeg";
    else if (lowerPath.endsWith(".txt")) mimeType = "text/plain";
    else if (lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")) mimeType = "text/html";

    // Call Gemini API (gemini-3.6-flash recommended)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiApiKey}`;

    const promptText = `
You are an expert academic tutor and curriculum assistant.
Analyze this academic document thoroughly and extract structured, high-value learning material.

Respond ONLY with valid, raw JSON (no markdown fences, no triple backticks) matching this exact schema:
{
  "summary": "A clear, concise 2-4 sentence summary of the document's main focus and learning objectives.",
  "key_concepts": [
    "Key concept or formula 1 with brief explanation",
    "Key concept or formula 2 with brief explanation"
  ],
  "practice_questions": [
    {
      "question": "Rigorous practice question testing core understanding",
      "solution": "Step-by-step verified solution with KaTeX math notation where appropriate (use $...$ for inline and $$...$$ for display math)"
    }
  ],
  "parsed_markdown": "Full educational summary in Markdown format, with headers, bullet points, and KaTeX math notation for all mathematical formulas."
}
`;

    const geminiReqBody = {
      contents: [
        {
          role: "user",
          parts: [
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            },
            {
              text: promptText
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2
      }
    };

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReqBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error (${geminiRes.status}): ${errText}`);
    }

    const geminiJson = await geminiRes.json();
    const rawContent = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawContent) {
      throw new Error("No content received from Gemini model");
    }

    // Clean up potential markdown formatting if the model included it despite prompt
    let cleanJsonStr = rawContent.trim();
    if (cleanJsonStr.startsWith("```json")) {
      cleanJsonStr = cleanJsonStr.slice(7);
    } else if (cleanJsonStr.startsWith("```")) {
      cleanJsonStr = cleanJsonStr.slice(3);
    }
    if (cleanJsonStr.endsWith("```")) {
      cleanJsonStr = cleanJsonStr.slice(0, -3);
    }
    cleanJsonStr = cleanJsonStr.trim();

    const parsedData = JSON.parse(cleanJsonStr);

    // Update material row in database
    const { error: updateError } = await supabase
      .from("materials")
      .update({
        content_json: parsedData,
        status: "completed",
        error_message: null
      })
      .eq("id", material_id);

    if (updateError) {
      throw new Error(`Failed to update material record: ${updateError.message}`);
    }

    console.log(`Successfully processed material ${material_id}`);

    return new Response(
      JSON.stringify({ success: true, material_id, data: parsedData }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error processing document:", err);

    // Attempt to update material with error status if material_id is known
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (supabaseUrl && supabaseServiceKey) {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const reqClone = req.clone();
        const body = await reqClone.json().catch(() => ({}));
        const material_id = body.material_id || body.record?.id;
        if (material_id) {
          await supabase
            .from("materials")
            .update({ status: "error", error_message: (err as Error).message })
            .eq("id", material_id);
        }
      }
    } catch (_) {
      // ignore secondary error
    }

    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
