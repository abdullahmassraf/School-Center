// ============================================================================
// src/ai-history.js — Cross-device AI chat + media persistence via Supabase
// ============================================================================

import { getSupabase, isSupabaseConfigured } from './supabase.js';

const LOCAL_HISTORY_KEY = 'schoolcenter_ai_chat_local_v2';
const MEDIA_BUCKET = 'ai-chat-media';
const CONVERSATION_KIND = 'school-center-default';

function localRead() {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function localWrite(messages) {
  try { localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(messages.slice(-200))); } catch (_) {}
}

function messageToLocal(m) {
  return {
    id: m.id || `local_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    sender: m.role === 'user' ? 'user' : 'assistant',
    text: m.content || '',
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    createdAt: m.created_at || m.createdAt || new Date().toISOString()
  };
}

function kindForMime(mime = '') {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'pdf';
  return 'file';
}

function safeFileName(name) {
  return String(name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
}

export async function getCurrentAiUser() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getUser();
    return data?.user || null;
  } catch (_) {
    return null;
  }
}


export async function getEphemeralLiveToken() {
  const sb = getSupabase();
  if (!sb) throw new Error('Connect Supabase in Settings first.');
  const { data, error } = await sb.functions.invoke('gemini-live-token', { body: {} });
  if (error) throw new Error(error.message || 'Could not create a live transcription token.');
  if (!data?.token) throw new Error(data?.error || 'Could not create a live transcription token.');
  return data.token;
}

export async function sendAiMagicLink(email) {
  const sb = getSupabase();
  if (!sb) throw new Error('Connect Supabase in Settings first.');
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await sb.auth.signInWithOtp({
    email: String(email || '').trim(),
    options: { emailRedirectTo: redirectTo }
  });
  if (error) throw error;
}

export async function signOutAiCloud() {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.auth.signOut();
  if (error) throw error;
}

async function getOrCreateConversation(userId) {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: existing, error: lookupError } = await sb
    .from('ai_conversations')
    .select('id,user_id,kind,title,created_at,updated_at')
    .eq('user_id', userId)
    .eq('kind', CONVERSATION_KIND)
    .maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing;

  const { data: created, error: insertError } = await sb
    .from('ai_conversations')
    .insert({ user_id: userId, kind: CONVERSATION_KIND, title: 'School Center AI' })
    .select()
    .single();
  if (insertError) throw insertError;
  return created;
}

async function signedMediaUrl(path) {
  const sb = getSupabase();
  if (!sb || !path) return '';
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60 * 24);
  if (error) return '';
  return data?.signedUrl || '';
}

async function hydrateAttachments(attachments = []) {
  return Promise.all(attachments.map(async a => ({
    ...a,
    kind: a.kind || kindForMime(a.mimeType || a.mime_type || ''),
    url: a.url || await signedMediaUrl(a.path || '')
  })));
}

export async function loadAiChatHistory() {
  const user = await getCurrentAiUser();
  if (!user) return { user: null, messages: localRead(), cloud: false };
  const sb = getSupabase();
  if (!sb) return { user, messages: localRead(), cloud: false };

  try {
    const conversation = await getOrCreateConversation(user.id);
    if (!conversation) return { user, messages: localRead(), cloud: false };

    const { data, error } = await sb
      .from('ai_messages')
      .select('id,conversation_id,user_id,role,content,attachments,created_at')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;

    let messages = await Promise.all((data || []).map(async m => ({
      ...messageToLocal(m),
      attachments: await hydrateAttachments(Array.isArray(m.attachments) ? m.attachments : [])
    })));

    // One-time migration: move locally cached conversations to the authenticated cloud account.
    const local = localRead();
    if (!messages.length && local.length) {
      for (const m of local) {
        await sb.from('ai_messages').insert({
          conversation_id: conversation.id,
          user_id: user.id,
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: String(m.text || ''),
          attachments: Array.isArray(m.attachments) ? m.attachments : []
        });
      }
      messages = local;
    }

    localWrite(messages);
    return { user, messages, cloud: true };
  } catch (error) {
    console.warn('AI cloud history unavailable; continuing locally:', error);
    return { user, messages: localRead(), cloud: false, error };
  }
}

export async function persistAiMessage({ sender, text, files = [], attachments = [] }) {
  const localMessage = {
    id: `local_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    sender,
    text: String(text || ''),
    attachments: Array.isArray(attachments) ? attachments : [],
    createdAt: new Date().toISOString()
  };

  const user = await getCurrentAiUser();
  const sb = getSupabase();
  if (!user || !sb) {
    const localAttachments = [...(attachments || [])];
    for (const file of files || []) {
      try {
        localAttachments.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          kind: kindForMime(file.type || ''),
          url: URL.createObjectURL(file),
          localOnly: true
        });
      } catch (_) {}
    }
    localMessage.attachments = localAttachments;
    const local = localRead();
    localWrite([...local, localMessage]);
    return localMessage;
  }

  try {
    const conversation = await getOrCreateConversation(user.id);
    const uploaded = [];
    for (const file of files || []) {
      const safeName = safeFileName(file.name);
      const path = `${user.id}/${conversation.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream'
      });
      if (uploadError) throw uploadError;
      uploaded.push({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        path,
        kind: kindForMime(file.type || '')
      });
    }

    const finalAttachments = [...(attachments || []), ...uploaded];
    const { data, error } = await sb.from('ai_messages').insert({
      conversation_id: conversation.id,
      user_id: user.id,
      role: sender === 'user' ? 'user' : 'assistant',
      content: String(text || ''),
      attachments: finalAttachments
    }).select().single();
    if (error) throw error;

    const cloudMessage = {
      ...messageToLocal(data),
      attachments: await hydrateAttachments(finalAttachments)
    };
    const local = localRead();
    localWrite([...local, cloudMessage]);
    return cloudMessage;
  } catch (error) {
    console.warn('AI message could not be saved to cloud; kept locally:', error);
    const local = localRead();
    localWrite([...local, localMessage]);
    return localMessage;
  }
}

export async function subscribeToAiChatHistory(userId, onMessage = () => {}) {
  const sb = getSupabase();
  if (!sb || !userId) return () => {};
  try {
    const conversation = await getOrCreateConversation(userId);
    if (!conversation) return () => {};
    const channel = sb.channel(`ai-history-${conversation.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_messages', filter: `conversation_id=eq.${conversation.id}` }, async payload => {
        try {
          const message = messageToLocal(payload.new);
          message.attachments = await hydrateAttachments(Array.isArray(payload.new.attachments) ? payload.new.attachments : []);
          onMessage(message);
        } catch (error) {
          console.warn('AI realtime message hydration failed:', error);
        }
      })
      .subscribe();
    return () => { try { sb.removeChannel(channel); } catch (_) {} };
  } catch (error) {
    console.warn('AI realtime subscription unavailable:', error);
    return () => {};
  }
}

export async function persistAssistantAttachments(attachments = [], text = '') {
  // Reserved for future AI-generated media providers. Current Gemini text responses remain text-first,
  // while any media URLs/attachments already returned by the AI can still be rendered by the UI.
  return persistAiMessage({ sender: 'assistant', text, attachments });
}

export async function deleteAiMessage(messageId) {
  const local = localRead().filter(m => m.id !== messageId);
  localWrite(local);
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (sb && user && !String(messageId).startsWith('local_')) {
    try { await sb.from('ai_messages').delete().eq('id', messageId).eq('user_id', user.id); }
    catch (error) { console.warn('Could not delete cloud AI message:', error); }
  }
}

export async function updateAiMessageText(messageId, newText) {
  const local = localRead().map(m => m.id === messageId ? { ...m, text: newText } : m);
  localWrite(local);
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (sb && user && !String(messageId).startsWith('local_')) {
    try { await sb.from('ai_messages').update({ content: newText }).eq('id', messageId).eq('user_id', user.id); }
    catch (error) { console.warn('Could not update cloud AI message:', error); }
  }
}

export async function clearAiConversation() {
  localWrite([]);
  const sb = getSupabase();
  const user = await getCurrentAiUser();
  if (!sb || !user) return;
  try {
    const conversation = await getOrCreateConversation(user.id);
    if (conversation) await sb.from('ai_messages').delete().eq('conversation_id', conversation.id).eq('user_id', user.id);
  } catch (error) {
    console.warn('Could not clear cloud AI history:', error);
  }
}

export function localAiHistory() {
  return localRead();
}

export function clearLocalAiHistory() {
  try { localStorage.removeItem(LOCAL_HISTORY_KEY); } catch (_) {}
}
