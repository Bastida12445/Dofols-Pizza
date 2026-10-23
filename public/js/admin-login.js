document.addEventListener('DOMContentLoaded', async () => {
  await window.appReady;
  const form = document.getElementById('login-form');
  const client = window.getSupabaseClient();
  if (!client) { document.getElementById('login-error').textContent = 'Supabase browser authentication is not configured. Complete the .env setup first.'; return; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = document.getElementById('login-button');
    const errorNode = document.getElementById('login-error');
    errorNode.textContent = ''; button.disabled = true; button.textContent = 'Signing in…';
    try {
      const auth = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: document.getElementById('email').value.trim(), password: document.getElementById('password').value }) });
      const tokens = await auth.json().catch(() => ({}));
      if (!auth.ok) throw new Error(tokens.error || 'Email or password is incorrect.');
      const { error } = await client.auth.setSession({ access_token: tokens.access_token, refresh_token: tokens.refresh_token });
      if (error) throw new Error('Could not start your administrator session. Please try again.');
      try {
        await window.api('/api/admin/me');
        await window.api('/api/admin/session', { method: 'POST', body: '{}' });
      }
      catch (error) { await client.auth.signOut(); throw error; }
      location.href = '/admin/dashboard.html';
    } catch (error) { errorNode.textContent = error.message; button.disabled = false; button.textContent = 'Sign in'; }
  });
});
