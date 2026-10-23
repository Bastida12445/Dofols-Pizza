const { supabase } = require('../config/supabase');

async function requireAdmin(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Please sign in as an administrator.' });

  const { data: userData, error: userError } = await supabase.auth.getUser(match[1]);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });

  const { data: profile, error: profileError } = await supabase
    .from('admin_profiles').select('id,full_name,role').eq('id', userData.user.id).maybeSingle();
  if (profileError || !profile || !['admin', 'owner'].includes(profile.role)) {
    return res.status(403).json({ error: 'This account does not have administrator access.' });
  }
  req.admin = { id: profile.id, name: profile.full_name, role: profile.role, email: userData.user.email };
  next();
}

module.exports = { requireAdmin };
