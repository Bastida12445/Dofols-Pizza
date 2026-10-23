require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const { createClient } = require('@supabase/supabase-js');

async function hiddenPrompt(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this command in an interactive PowerShell terminal so the password can be entered privately.');
  }
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (key) => {
      if (key === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        reject(new Error('Cancelled.'));
        return;
      }
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (key === '\u007f' || key === '\b') value = value.slice(0, -1);
      else if (key >= ' ') value += key;
    };
    stdin.on('data', onData);
  });
}

async function findUserByEmail(supabase, email) {
  const perPage = 100;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Could not search Supabase Auth users: ${error.message}`);
    const user = (data.users || []).find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if ((data.users || []).length < perPage) return null;
  }
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.');
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  const email = (await rl.question('Existing administrator email: ')).trim().toLowerCase();
  rl.close();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');

  const password = await hiddenPrompt('New password (12+ characters, input hidden): ');
  const confirmation = await hiddenPrompt('Confirm new password (input hidden): ');
  if (password.length < 12) throw new Error('Use a password with at least 12 characters.');
  if (password !== confirmation) throw new Error('The passwords do not match. Nothing was changed.');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
  const user = await findUserByEmail(supabase, email);
  if (!user) throw new Error('No Supabase Auth user was found for that email. Nothing was changed.');

  const { data: profile, error: profileError } = await supabase
    .from('admin_profiles').select('id').eq('id', user.id).maybeSingle();
  if (profileError) throw new Error(`Could not verify the administrator profile: ${profileError.message}`);
  if (!profile) throw new Error('That account does not have an administrator profile. Nothing was changed.');

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateError) throw new Error(`Could not reset the password: ${updateError.message}`);
  console.log(`Administrator password updated for ${email}. You can sign in at /admin/login.html.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
