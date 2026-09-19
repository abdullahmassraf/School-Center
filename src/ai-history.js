// ============================================================================
// src/ai-history.js — Cross-device AI chat + media persistence via Supabase
// ============================================================================

import { getSupabase, isSupabaseConfigured } from './supabase.js';

/** The single shared app account. The sign-in UI asks only for a password:
 * this email is fixed client-side and the account is provisioned with the
 * matching password, so users never type an email or username. */
const OWNER_ACCOUNT_EMAIL = 'abdullah2001massraf@gmail.com';

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

/* v1.3.0: this used to call sb.auth.getUser(), which issues a network request
 * to /auth/v1/user on EVERY call. data-sync.js calls requireCloudIdentity()
 * once per table read and once per table write, so a single reconciliation
 * pass made four or more extra round-trips — and any one of them failing
 * (flaky wifi, a phone waking from sleep) returned null, which the sync
 * engine reports as "not signed in". getSession() reads the persisted session
 * locally and lets supabase-js refresh the token on its own schedule.
 * getUser() is kept as a fallback for the very first call after a magic-link
 * redirect, when the session may not be in storage yet. */
export async function getCurrentAiUser() {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data: sessionData } = await sb.auth.getSession();
    const sessionUser = sessionData?.session?.user;
    if (sessionUser) return sessionUser;
  } catch (_) {}
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
  try {
    const { error } = await sb.auth.signInWithOtp({
      email: String(email || '').trim(),
      options: { emailRedirectTo: redirectTo }
    });
    if (error) throw error;
  } catch (error) {
    // Magic links depend on Supabase's built-in email service, which allows
    // only a couple of messages per hour on the free tier. A 429 here used to
    // surface as a generic failure with no hint of the real cause or that a
    // password sign-in below needs no email at all.
    const raw = String(error?.message || error || '');
    if (error?.code === 'over_email_send_rate_limit' || raw.includes('rate limit')) {
      throw new Error('Email sign-in is rate limited right now (Supabase free tier allows very few emails per hour). Use the email + password option below instead — it works immediately.');
    }
    throw new Error(raw || 'Could not send the sign-in email.');
  }
}

/**
 * Email + password sign-in / registration. Password sign-in has NO email
 * dependency, so it works even when the built-in mailer is rate limited —
 * which is exactly why it is offered: on this project the hourly magic-link
 * quota was exhausted, leaving users unable to sign in at all.
 * - Existing account + correct password: signs in.
 * - No account yet: creates one with these credentials (first device sets
 *   the password; other devices then sign in with the same email+password).
 * - Existing account + wrong password: falls through with the auth error.
 */
export async function signInAiWithPassword(email, password) {
  const sb = getSupabase();
  if (!sb) throw new Error('Connect Supabase in Settings first.');
  const cleanEmail = String(email || '').trim();
  const cleanPassword = String(password || '');
  if (!cleanEmail) throw new Error('Enter your email address.');
  if (cleanPassword.length < 6) throw new Error('Password must be at least 6 characters.');

  const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
    email: cleanEmail,
    password: cleanPassword
  });
  if (!signInError) return signInData.session;

  // An existing account whose email was never confirmed cannot sign in with a
  // password. Registration cannot proceed either, so explain the two real
  // ways out instead of falling into the "wrong password" path below.
  const rawSignIn = String(signInError.message || '');
  if (/email not confirmed/i.test(rawSignIn)) {
    throw new Error('This account\'s email has not been confirmed yet. Open the sign-in link email once on this device to confirm it — or turn OFF "Confirm email" in Supabase Dashboard → Authentication → Sign In / Providers → Email, which makes password sign-in work with no email at all.');
  }

  const notFound = signInError.code === 'user_not_found'
    || /invalid login credentials/i.test(rawSignIn);

  if (!notFound) throw signInError;

  // No existing account for this email — register it with these credentials.
  const { data: signUpData, error: signUpError } = await sb.auth.signUp({
    email: cleanEmail,
    password: cleanPassword
  });
  if (signUpError) {
    // A user already exists but with a different password lands here on
    // some project configs; make the actionable answer obvious.
    const raw = String(signUpError.message || '');
    if (/already registered|already exists/i.test(raw)) {
      throw new Error('An account with this email already exists. Enter its original password.');
    }
    if (signUpError.code === 'over_email_send_rate_limit' || /rate limit/i.test(raw) || !raw) {
      throw new Error('Account creation is temporarily rate limited because this project emails a confirmation for new sign-ups and the built-in mailer quota is exhausted. Try again in about an hour — or turn OFF "Confirm email" in Supabase Dashboard → Authentication → Providers → Email, which removes the email requirement entirely.');
    }
    throw signUpError;
  }
  if (!signUpData?.session) {
    // "Confirm email" is enabled on this project: the account was created but
    // stays unusable until the confirmation link in the email is opened once.
    throw new Error('Account created, but this project requires email confirmation before first sign-in. Open the confirmation email on this device once. To skip this requirement on every future device, turn OFF "Confirm email" in Supabase Dashboard → Authentication → Providers → Email.');
  }
  return signUpData.session;
}

/**
 * Password-only sign-in for the app's single shared account. The account
 * (pre-provisioned server-side with a fixed email) is already set up, so the
 * user only ever types the account password — no email or username. Signing
 * in attaches this device to the cloud session that powers cross-device
 * sync. Wrong passwords fail with Supabase's standard invalid-credentials
 * error.
 */
export async function signInWithAccountPassword(password) {
  const sb = getSupabase();
  if (!sb) throw new Error('Connect Supabase in Settings first.');
  const cleanPassword = String(password || '');
  if (!cleanPassword) throw new Error('Enter the account password.');

  const { data, error } = await sb.auth.signInWithPassword({
    email: OWNER_ACCOUNT_EMAIL,
    password: cleanPassword
  });
  if (error) {
    const raw = String(error.message || '');
    // Never call auth.signUp() here as a probe: against a passwordless
    // account it can trigger a confirmation/recovery email, which users
    // experience as a mysterious "link sent". The failure message below
    // states the exact one-time dashboard fix instead.
    if (/invalid login credentials/i.test(raw) || error.code === 'user_not_found') {
      throw new Error('Password does not match. If you have never set this password on the cloud account: Supabase Dashboard → Authentication → Users → this account → Reset password, set it once, then sign in here. No emails are involved after that.');
    }
    if (/email not confirmed/i.test(raw)) {
      throw new Error('The account email is not confirmed yet. Try again shortly.');
    }
    throw error;
  }
  return data?.session || null;
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
