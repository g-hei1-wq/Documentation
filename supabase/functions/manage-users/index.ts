import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !serviceKey || !authorization?.startsWith('Bearer ')) {
    return json({ error: 'Missing server configuration or sign-in.' }, 401);
  }

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
  const token = authorization.slice('Bearer '.length);
  const { data: authData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'Sign-in required.' }, 401);

  const { data: caller, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', authData.user.id)
    .single();
  if (profileError || caller?.role !== 'admin') return json({ error: 'Administrator access required.' }, 403);

  let body: { action?: string; email?: string; password?: string; fullName?: string; role?: string; userId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  if (typeof body.password !== 'string' || body.password.length < 12) {
    return json({ error: 'Passwords must be at least 12 characters.' }, 400);
  }

  if (body.action === 'create_user') {
    const email = body.email?.trim().toLowerCase();
    const fullName = body.fullName?.trim();
    const role = body.role === 'admin' ? 'admin' : 'member';
    if (!email || !fullName || fullName.length > 120) return json({ error: 'A valid email and full name are required.' }, 400);

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password: body.password,
      email_confirm: true,
      user_metadata: { full_name: fullName }
    });
    if (createError || !created.user) return json({ error: createError?.message || 'Could not create account.' }, 400);

    const { error: insertError } = await adminClient.from('profiles').insert({
      id: created.user.id,
      email,
      full_name: fullName,
      role
    });
    if (insertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      return json({ error: 'Account profile could not be created.' }, 500);
    }
    return json({ userId: created.user.id });
  }

  if (body.action === 'change_password') {
    if (!body.userId) return json({ error: 'A user ID is required.' }, 400);
    const { error } = await adminClient.auth.admin.updateUserById(body.userId, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ success: true });
  }

  return json({ error: 'Unknown action.' }, 400);
});
