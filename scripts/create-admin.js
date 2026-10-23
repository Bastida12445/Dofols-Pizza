require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { createClient } = require('@supabase/supabase-js');

async function hiddenPrompt(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Run this command in an interactive PowerShell terminal so the password can be entered privately.');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (key) => {
      if (key === '\u0003') { stdin.setRawMode(false); stdin.pause(); reject(new Error('Cancelled.')); return; }
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); stdout.write('\n'); resolve(value); return;
      }
      if (key === '\u007f' || key === '\b') value = value.slice(0, -1);
      else if (key >= ' ') value += key;
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Administrator email: ')).trim().toLowerCase();
  const fullName = (await rl.question('Administrator name: ')).trim();
  rl.close();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2 || fullName.length > 120) throw new Error('Enter a valid email and a name between 2 and 120 characters.');
  const password = await hiddenPrompt('Administrator password (12+ characters, input hidden): ');
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (error) throw new Error(`Could not create the Auth user: ${error.message}`);
  const { error: profileError } = await supabase.from('admin_profiles').insert({ id: data.user.id, full_name: fullName, role: 'owner' });
  if (profileError) {
    await supabase.auth.admin.deleteUser(data.user.id);
    throw new Error(`Could not create the administrator profile; the new Auth user was removed. ${profileError.message}`);
  }
  console.log(`Administrator created for ${email}. Sign in at /admin/login.html.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
