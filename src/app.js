const path = require('node:path');
const { isIP } = require('node:net');
const crypto = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { supabase, url, publishableKey } = require('./config/supabase');
const { requireAdmin } = require('./middleware/admin-auth');
const paymongo = require('./payments/paymongo');
const { getDrivingRoute } = require('./payments/google-routes');

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const firstRelation = (value) => Array.isArray(value) ? (value[0] || null) : (value || null);

function isPublicHttpsOrigin(value) {
  try {
    const baseUrl = new URL(value || '');
    const hostname = baseUrl.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    const reservedHost = hostname === 'localhost' || ['.localhost', '.local', '.internal', '.test', '.example', '.invalid', '.home.arpa', '.lan'].some((suffix) => hostname.endsWith(suffix));
    return baseUrl.protocol === 'https:' && !baseUrl.username && !baseUrl.password
      && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === '/'
      && hostname.includes('.') && isIP(hostname) === 0 && !reservedHost;
  } catch { return false; }
}

function paymongoCheckoutReady() {
  return paymongo.isLiveModeConfigured() && isPublicHttpsOrigin(process.env.APP_BASE_URL);
}

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(compression());

async function markGatewayPaymentPaid(payment, session, eventId = '') {
  const attrs = session?.attributes || {};
  const paid = paymongo.extractPaidPayment(session);
  const metadata = attrs.metadata || {};
  if (!paid || attrs.livemode !== true || session.id !== payment.gateway_session_id || attrs.reference_number !== payment.order_number
      || metadata.dofols_order_id !== payment.order_id || paid.currency !== 'PHP'
      || paid.amount !== Math.round(Number(payment.amount) * 100)) return false;
  if (payment.payment_status === 'Paid') return true;
  if (payment.payment_status !== 'Pending') return false;

  const { error: updateError } = await supabase.from('payments').update({ gateway_payment_id: paid.id, updated_at: new Date().toISOString() }).eq('id', payment.id);
  if (updateError) throw updateError;
  const { error } = await supabase.rpc('admin_verify_payment', {
    p_payment_id: payment.id,
    p_new_status: 'Paid',
    p_admin_id: null,
    p_notes: `PayMongo confirmed payment${eventId ? ` (${eventId})` : ''}.`
  });
  if (error) {
    const { data: current, error: readError } = await supabase.from('payments').select('payment_status').eq('id', payment.id).single();
    if (readError) throw readError;
    return current.payment_status === 'Paid';
  }
  return true;
}

async function startPaymongoCheckout(orderId) {
  if (!paymongoCheckoutReady()) {
    const error = new Error('Live GCash needs a PayMongo live secret key, the live webhook signing secret, and an HTTPS APP_BASE_URL.');
    error.status = 503;
    throw error;
  }
  const { data: order, error } = await supabase.from('orders')
    .select('id,order_number,total_amount,delivery_fee,payment_method,order_items(product_name_snapshot,size_name_snapshot,unit_price_snapshot,quantity),payments(id,amount,payment_status,gateway_session_id,gateway_checkout_url)')
    .eq('id', orderId).single();
  if (error) throw error;
  const payment = firstRelation(order.payments);
  if (order.payment_method !== 'gcash') {
    const invalid = new Error('This order uses a different payment method, so GCash checkout cannot be opened.');
    invalid.status = 409;
    throw invalid;
  }
  if (!payment) {
    const invalid = new Error('The payment record for this order could not be found. Please contact the restaurant.');
    invalid.status = 409;
    throw invalid;
  }
  if (payment.payment_status !== 'Pending') {
    const invalid = new Error(`This GCash payment is already ${payment.payment_status.toLowerCase()} and cannot be reopened. Please contact the restaurant if you need help.`);
    invalid.status = 409;
    throw invalid;
  }
  if (payment.gateway_session_id && payment.gateway_checkout_url) {
    let existingSession = null;
    try { existingSession = await paymongo.retrieveCheckoutSession(payment.gateway_session_id); }
    catch (retrieveError) { if (retrieveError.status !== 404) throw retrieveError; }
    if (existingSession?.attributes?.livemode === true) {
      return { id: payment.gateway_session_id, url: payment.gateway_checkout_url };
    }
    if (existingSession && existingSession.attributes?.livemode !== false) {
      throw new Error('Could not confirm that the saved PayMongo checkout is in live mode.');
    }
    const { error: clearError } = await supabase.from('payments')
      .update({ gateway_session_id: null, gateway_checkout_url: null, updated_at: new Date().toISOString() })
      .eq('id', payment.id).eq('payment_status', 'Pending');
    if (clearError) throw clearError;
  }

  const configuredBaseUrl = process.env.APP_BASE_URL;
  const baseUrl = new URL(configuredBaseUrl);
  if (!isPublicHttpsOrigin(configuredBaseUrl)) throw new Error('Live PayMongo checkout requires APP_BASE_URL to be the public HTTPS site origin.');
  const session = await paymongo.createCheckoutSession({ order, items: order.order_items || [], baseUrl: baseUrl.origin });
  const { error: saveError } = await supabase.from('payments').update({
    gateway_session_id: session.id,
    gateway_checkout_url: session.url,
    updated_at: new Date().toISOString()
  }).eq('id', payment.id);
  if (saveError) throw saveError;
  return session;
}

app.post('/api/webhooks/paymongo', express.raw({ type: 'application/json', limit: '1mb' }), asyncRoute(async (req, res) => {
  if (!paymongo.isLiveModeConfigured()) return res.status(503).json({ error: 'PayMongo live webhook is not configured.' });
  const rawBody = req.body;
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Invalid webhook payload.' }); }
  const eventData = event?.data || {};
  const eventAttrs = eventData.attributes || {};
  const livemode = typeof eventAttrs.livemode === 'boolean' ? eventAttrs.livemode : Boolean(eventData.livemode);
  if (!livemode || !paymongo.verifyWebhook(rawBody, req.get('paymongo-signature'), String(process.env.PAYMONGO_WEBHOOK_SECRET || '').trim(), true)) {
    return res.status(401).json({ error: 'Invalid PayMongo live webhook signature.' });
  }
  const eventType = eventAttrs.type || eventData.type;
  if (eventType !== 'checkout_session.payment.paid') return res.status(200).json({ received: true });
  const session = eventAttrs.data || eventData.data;
  if (!session?.id) return res.status(400).json({ error: 'Checkout session ID is missing.' });
  const { data: payment, error } = await supabase.from('payments')
    .select('id,order_id,amount,payment_status,gateway_session_id,orders!inner(order_number)')
    .eq('gateway_session_id', session.id).maybeSingle();
  if (error) throw error;
  if (!payment) return res.status(200).json({ received: true });
  const linkedOrder = firstRelation(payment.orders);
  if (!linkedOrder) return res.status(200).json({ received: true });
  const linkedPayment = { ...payment, order_number: linkedOrder.order_number };
  const valid = await markGatewayPaymentPaid(linkedPayment, session, eventData.id || '');
  if (!valid) console.error('PayMongo webhook did not match its pending order:', session.id);
  res.status(200).json({ received: true });
}));

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const publicOrderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false });
const deliveryQuoteLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const orderLookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
const loginApiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
const productImageLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });
const authClient = createClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PRODUCT_IMAGE_BUCKET = 'product-images';
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      const error = new Error('Choose a JPEG, PNG, or WebP image.');
      error.status = 400;
      return callback(error);
    }
    callback(null, true);
  }
});

function detectProductImageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: "Dofol's Freshly Baked Pizza API" }));
app.get('/api/health/database', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('business_settings').select('id,delivery_base_fee').eq('id', true).maybeSingle();
  if (error?.code === 'PGRST205') return res.json({ status: 'schema_missing' });
  if (error?.code === 'PGRST204' || error?.code === '42703') return res.json({ status: 'migration_required' });
  if (error) throw error;
  res.json({ status: data ? 'connected' : 'schema_missing' });
}));
app.get('/api/public-config', (_req, res) => res.json({ supabaseUrl: url, supabasePublishableKey: publishableKey }));

app.get('/api/menu', asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('products')
    .select('id,name,description,image_url,category,is_available,product_sizes(id,size_name,price,is_available)')
    .eq('is_available', true).eq('is_archived', false).order('name');
  if (error) throw error;
  const products = (data || []).map((product) => ({
    ...product,
    product_sizes: (product.product_sizes || []).filter((size) => size.is_available).sort((a, b) => a.price - b.price)
  })).filter((product) => product.product_sizes.length);
  res.json({ products });
}));

async function getSettings() {
  const { data, error } = await supabase.from('business_settings').select('*').eq('id', true).single();
  if (error) throw error;
  return data;
}
function deliveryIsConfigured(settings) {
  return Boolean(settings.delivery_enabled && process.env.GOOGLE_MAPS_ROUTES_API_KEY
    && settings.business_latitude !== null && settings.business_latitude !== undefined
    && settings.business_longitude !== null && settings.business_longitude !== undefined
    && Number(settings.delivery_fee_per_km) > 0 && Number(settings.delivery_max_distance_km) > 0);
}
async function calculateDeliveryQuote(settings, destinationAddress) {
  if (!deliveryIsConfigured(settings)) {
    const error = new Error('Delivery is not configured yet. Please choose pickup or contact the restaurant.');
    error.status = 503;
    throw error;
  }
  const route = await getDrivingRoute(
    { latitude: settings.business_latitude, longitude: settings.business_longitude },
    { address: destinationAddress }
  );
  const exactDistanceKm = route.distanceMeters / 1000;
  const distanceKm = Math.ceil(exactDistanceKm * 100) / 100;
  const maxDistanceKm = Number(settings.delivery_max_distance_km);
  if (exactDistanceKm <= 0 || exactDistanceKm > maxDistanceKm) {
    const error = new Error(exactDistanceKm > maxDistanceKm
      ? `This address is outside the ${maxDistanceKm} km delivery area.`
      : 'Could not calculate a valid driving distance for this location.');
    error.status = 400;
    throw error;
  }
  const chargeableKm = Math.ceil(distanceKm);
  const fee = Math.round((Number(settings.delivery_base_fee) + Number(settings.delivery_fee_per_km) * chargeableKm) * 100) / 100;
  return {
    distance_km: distanceKm,
    chargeable_km: chargeableKm,
    delivery_fee: fee,
    destination_latitude: route.destination.latitude,
    destination_longitude: route.destination.longitude
  };
}
app.get('/api/settings', asyncRoute(async (_req, res) => {
  const row = await getSettings();
  res.json({ settings: {
    business_name: row.business_name,
    business_address: row.business_address,
    business_phone: row.business_phone,
    business_hours: row.business_hours,
    pickup_enabled: row.pickup_enabled,
    delivery_enabled: deliveryIsConfigured(row),
    delivery_base_fee: row.delivery_base_fee,
    delivery_fee_per_km: row.delivery_fee_per_km,
    delivery_max_distance_km: row.delivery_max_distance_km,
    gcash_enabled: Boolean(row.gcash_enabled && paymongoCheckoutReady()),
    gcash_gateway_ready: paymongoCheckoutReady(),
    gcash_instructions: '',
    maya_enabled: row.maya_enabled,
    maya_instructions: row.maya_instructions
  } });
}));

app.post('/api/delivery/quote', deliveryQuoteLimiter, asyncRoute(async (req, res) => {
  const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
  if (address.length < 8 || address.length > 500) {
    return res.status(400).json({ error: 'Enter a complete delivery address, including barangay and town, to calculate the route.' });
  }
  const quote = await calculateDeliveryQuote(await getSettings(), address);
  res.json({ quote });
}));

app.post('/api/orders', publicOrderLimiter, asyncRoute(async (req, res) => {
  const body = req.body || {};
  const name = String(body.customer_name || '').trim();
  const phone = String(body.customer_phone || '').trim();
  const type = body.order_type;
  const method = body.payment_method;
  const items = body.items;
  const allowedTypes = ['pickup', 'delivery'];
  const allowedMethods = ['cash_on_pickup', 'cash_on_delivery', 'gcash', 'maya'];
  if (name.length < 2 || name.length > 120 || phone.length < 7 || phone.length > 30) return res.status(400).json({ error: 'Enter your name and a valid mobile number.' });
  if (!allowedTypes.includes(type) || !allowedMethods.includes(method)) return res.status(400).json({ error: 'Choose a valid order type and payment method.' });
  if (typeof body.notes === 'string' && body.notes.length > 500) return res.status(400).json({ error: 'Order notes must be 500 characters or fewer.' });
  if (typeof body.delivery_address === 'string' && body.delivery_address.length > 500) return res.status(400).json({ error: 'Delivery address is too long.' });
  if (typeof body.reference_number === 'string' && body.reference_number.trim().length > 100) return res.status(400).json({ error: 'Payment reference is too long.' });
  const settings = await getSettings();
  if (method === 'gcash' && (!settings.gcash_enabled || !paymongoCheckoutReady())) return res.status(503).json({ error: 'Live GCash checkout is not configured yet. Choose another payment method or contact the restaurant.' });
  if (!Array.isArray(items) || items.length < 1 || items.length > 30 || items.some((item) => !item || !UUID_RE.test(item.product_id || '') || !UUID_RE.test(item.size_id || '') || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)) {
    return res.status(400).json({ error: 'Your cart has invalid items. Please review it and try again.' });
  }
  let delivery = null;
  if (type === 'delivery') {
    const address = typeof body.delivery_address === 'string' ? body.delivery_address.trim() : '';
    if (address.length < 8 || address.length > 500) return res.status(400).json({ error: 'Enter a complete delivery address to calculate the driving route.' });
    delivery = await calculateDeliveryQuote(settings, address);
  }
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data, error } = await supabase.rpc('create_order_atomic', {
    p_customer_name: name, p_customer_phone: phone, p_order_type: type,
    p_delivery_address: body.delivery_address || null, p_notes: body.notes || '',
    p_payment_method: method, p_reference_number: method === 'maya' ? body.reference_number || null : null,
    p_tracking_token_hash: tokenHash, p_items: items.map(({ product_id, size_id, quantity }) => ({ product_id, size_id, quantity })),
    p_delivery_latitude: delivery?.destination_latitude ?? null,
    p_delivery_longitude: delivery?.destination_longitude ?? null,
    p_delivery_distance_km: delivery?.distance_km ?? null,
    p_delivery_fee: delivery?.delivery_fee ?? 0
  });
  if (error) {
    if (error.code === '22023') return res.status(400).json({ error: error.message });
    throw error;
  }
  if (method === 'gcash') {
    try {
      const session = await startPaymongoCheckout(data.id);
      return res.status(201).json({ order: data, tracking_token: token, checkout_url: session.url });
    } catch (checkoutError) {
      console.error('PayMongo Checkout Session could not be started:', checkoutError.status || 500);
      return res.status(201).json({ order: data, tracking_token: token, checkout_error: 'Your order was saved, but the GCash checkout could not open. Use the retry button on the confirmation page.' });
    }
  }
  res.status(201).json({ order: data, tracking_token: token });
}));

app.post('/api/orders/:orderNumber/gcash-checkout', orderLookupLimiter, asyncRoute(async (req, res) => {
  const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
  const token = req.get('x-order-token') || '';
  if (!/^DP-[A-Z0-9-]{8,30}$/.test(orderNumber) || !/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Enter a valid order number and tracking code.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: order, error } = await supabase.from('orders').select('id').eq('order_number', orderNumber).eq('tracking_token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!order) return res.status(404).json({ error: 'We could not find that order with this tracking code.' });
  const session = await startPaymongoCheckout(order.id);
  res.json({ checkout_url: session.url });
}));

app.get('/api/orders/:orderNumber', orderLookupLimiter, asyncRoute(async (req, res) => {
  const orderNumber = String(req.params.orderNumber || '').trim().toUpperCase();
  const token = req.get('x-order-token') || '';
  if (!/^DP-[A-Z0-9-]{8,30}$/.test(orderNumber) || !/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'Enter a valid order number and tracking code.' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { data: order, error } = await supabase.from('orders')
    .select('id,order_number,customer_name,order_type,delivery_address,delivery_distance_km,notes,subtotal,delivery_fee,total_amount,order_status,payment_method,created_at,tracking_token_hash,payments(id,payment_status,reference_number,amount,gateway_session_id,gateway_payment_id)')
    .eq('order_number', orderNumber).eq('tracking_token_hash', tokenHash).maybeSingle();
  if (error) throw error;
  if (!order) return res.status(404).json({ error: 'We could not find that order with this tracking code.' });
  let payment = firstRelation(order.payments);
  if (payment?.payment_status === 'Pending' && payment.gateway_session_id && paymongo.isLiveModeConfigured()) {
    try {
      const session = await paymongo.retrieveCheckoutSession(payment.gateway_session_id);
      const linkedPayment = { ...payment, order_id: order.id, order_number: order.order_number };
      if (await markGatewayPaymentPaid(linkedPayment, session)) {
        const paid = paymongo.extractPaidPayment(session);
        payment = { ...payment, payment_status: 'Paid', gateway_payment_id: paid?.id || payment.gateway_payment_id };
      }
    } catch (syncError) {
      console.error('PayMongo payment status check failed:', syncError.status || 500);
    }
  }
  const { data: items, error: itemError } = await supabase.from('order_items')
    .select('product_name_snapshot,size_name_snapshot,unit_price_snapshot,quantity,line_total').eq('order_id', order.id);
  if (itemError) throw itemError;
  res.json({ order: { ...order, tracking_token_hash: undefined, payments: undefined, payment: payment ? { payment_status: payment.payment_status, reference_number: payment.reference_number, amount: payment.amount } : null, items } });
}));

// Passwords are sent over same-origin HTTPS to Supabase Auth and are never logged.
// The endpoint adds an application-level rate limit before issuing a token.
app.post('/api/admin/login', adminLoginLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 1 || password.length > 256) return res.status(400).json({ error: 'Enter a valid email and password.' });
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) return res.status(401).json({ error: 'Email or password is incorrect.' });
  const { data: profile, error: profileError } = await supabase.from('admin_profiles').select('id,full_name,role').eq('id', data.user.id).maybeSingle();
  if (profileError || !profile || !['admin', 'owner'].includes(profile.role)) {
    await authClient.auth.signOut();
    return res.status(403).json({ error: 'This account does not have administrator access.' });
  }
  res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in });
}));
app.get('/api/admin/me', loginApiLimiter, requireAdmin, (req, res) => res.json({ admin: req.admin }));
app.post('/api/admin/session', loginApiLimiter, requireAdmin, (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_access=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=3600${secure}`);
  res.json({ message: 'Administrator page session started.' });
});
app.delete('/api/admin/session', (_req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin_access=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`);
  res.json({ message: 'Administrator page session ended.' });
});

app.get('/api/admin/products', requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('products').select('*,product_sizes(*)').order('created_at', { ascending: false });
  if (error) throw error;
  res.json({ products: data || [] });
}));
app.post('/api/admin/uploads/product-image', requireAdmin, productImageLimiter, productImageUpload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a product photo to upload.' });
  const imageType = detectProductImageType(req.file.buffer);
  if (!imageType || imageType.mime !== req.file.mimetype) return res.status(400).json({ error: 'The selected file is not a supported JPEG, PNG, or WebP image.' });

  const objectPath = `${req.admin.id}/${crypto.randomUUID()}.${imageType.ext}`;
  const { error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).upload(objectPath, req.file.buffer, {
    contentType: imageType.mime,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) {
    const bucketMissing = error.statusCode === '404' || /bucket not found/i.test(error.message || '');
    if (bucketMissing) return res.status(503).json({ error: 'Product image storage is not set up yet. Create the public product-images bucket in Supabase Storage.' });
    console.error('Product photo upload failed:', error.name || 'StorageError', error.statusCode || '');
    return res.status(502).json({ error: 'Could not upload the photo. Please try again.' });
  }
  const { data } = supabase.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(objectPath);
  res.status(201).json({ image_url: data.publicUrl });
}));
app.post('/api/admin/products', requireAdmin, asyncRoute(async (req, res) => {
  const p = req.body || {};
  if (p.id && !UUID_RE.test(p.id)) return res.status(400).json({ error: 'Invalid product ID.' });
  if (typeof p.name !== 'string' || p.name.trim().length < 2 || p.name.trim().length > 100 || !Array.isArray(p.sizes) || !p.sizes.length || p.sizes.length > 10) return res.status(400).json({ error: 'Enter a product name and at least one size.' });
  if (p.sizes.some((s) => !s || typeof s.size_name !== 'string' || !s.size_name.trim() || !Number.isFinite(Number(s.price)) || Number(s.price) < 0 || Number(s.price) > 100000)) return res.status(400).json({ error: 'Check each size and its nonnegative price.' });
  if (p.image_url && (typeof p.image_url !== 'string' || p.image_url.length > 1000 || !/^https:\/\//i.test(p.image_url))) return res.status(400).json({ error: 'Use a valid HTTPS image URL or leave it blank.' });
  const product = { id: p.id || null, name: p.name.trim(), description: String(p.description || '').slice(0, 1000), category: String(p.category || 'Pizza').slice(0, 60), image_url: p.image_url || null, is_available: p.is_available !== false, sizes: p.sizes.map((s) => ({ size_name: s.size_name.trim(), price: Number(s.price).toFixed(2), is_available: s.is_available !== false })) };
  const { data, error } = await supabase.rpc('admin_save_product', { p_product: product });
  if (error) { if (error.code === '22023') return res.status(400).json({ error: error.message }); throw error; }
  res.json({ id: data, message: 'Product saved.' });
}));
app.patch('/api/admin/products/:id/archive', requireAdmin, asyncRoute(async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid product ID.' });
  const { error } = await supabase.from('products').update({ is_archived: true, is_available: false, updated_at: new Date().toISOString() }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ message: 'Product archived.' });
}));

app.get('/api/admin/orders', requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('orders').select('id,order_number,customer_name,customer_phone,order_type,delivery_address,delivery_latitude,delivery_longitude,delivery_distance_km,notes,subtotal,delivery_fee,total_amount,order_status,payment_method,created_at,order_items(product_name_snapshot,size_name_snapshot,unit_price_snapshot,quantity,line_total),payments(id,payment_status,reference_number,gateway_session_id,amount)').order('created_at', { ascending: false }).limit(250);
  if (error) throw error;
  res.json({ orders: data || [] });
}));
app.patch('/api/admin/orders/:id/status', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.body?.status || '');
  const allowed = ['Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Completed', 'Cancelled'];
  if (!UUID_RE.test(req.params.id) || !allowed.includes(status)) return res.status(400).json({ error: 'Choose a valid next order status.' });
  const { error } = await supabase.rpc('admin_change_order_status', { p_order_id: req.params.id, p_new_status: status });
  if (error) { if (error.code === '22023' || error.code === 'P0002') return res.status(400).json({ error: error.message }); throw error; }
  res.json({ message: 'Order status updated.' });
}));

app.get('/api/admin/payments', requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('payments').select('*,orders(order_number,customer_name,customer_phone,order_type,total_amount,created_at),payment_status_history(id,previous_status,new_status,notes,created_at,changed_by_admin_id)').order('created_at', { ascending: false }).limit(250);
  if (error) throw error;
  res.json({ payments: data || [] });
}));
app.patch('/api/admin/payments/:id/status', requireAdmin, asyncRoute(async (req, res) => {
  const status = String(req.body?.status || '');
  if (!UUID_RE.test(req.params.id) || !['Paid', 'Failed', 'Refunded'].includes(status)) return res.status(400).json({ error: 'Choose a valid payment status.' });
  const notes = String(req.body?.notes || '').slice(0, 300);
  const { error } = await supabase.rpc('admin_verify_payment', { p_payment_id: req.params.id, p_new_status: status, p_admin_id: req.admin.id, p_notes: notes });
  if (error) { if (error.code === '22023' || error.code === 'P0002') return res.status(400).json({ error: error.message }); throw error; }
  res.json({ message: `Payment marked ${status}.` });
}));

app.get('/api/admin/settings', requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.from('business_settings').select('*').eq('id', true).single();
  if (error) throw error;
  res.json({ settings: data });
}));
app.put('/api/admin/settings', requireAdmin, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const stringFields = ['business_name', 'business_address', 'business_phone', 'business_hours', 'gcash_instructions', 'maya_instructions'];
  const row = {};
  for (const field of stringFields) {
    if (typeof b[field] !== 'string' || b[field].length > (field.includes('instructions') ? 1000 : 200)) return res.status(400).json({ error: `Check the ${field.replaceAll('_', ' ')} field.` });
    row[field] = b[field].trim();
  }
  for (const field of ['pickup_enabled', 'delivery_enabled', 'gcash_enabled', 'maya_enabled']) {
    if (typeof b[field] !== 'boolean') return res.status(400).json({ error: `Choose whether ${field.replaceAll('_', ' ')} is enabled.` });
    row[field] = b[field];
  }
  for (const [field, min, max] of [['business_latitude', -90, 90], ['business_longitude', -180, 180]]) {
    if (b[field] === null || b[field] === '') row[field] = null;
    else {
      const value = Number(b[field]);
      if (!Number.isFinite(value) || value < min || value > max) return res.status(400).json({ error: `Enter valid ${field.replaceAll('_', ' ')} coordinates.` });
      row[field] = value;
    }
  }
  for (const [field, max] of [['delivery_base_fee', 100000], ['delivery_fee_per_km', 100000], ['delivery_max_distance_km', 500]]) {
    const value = Number(b[field]);
    if (!Number.isFinite(value) || value < 0 || value > max) return res.status(400).json({ error: `Enter a valid ${field.replaceAll('_', ' ')}.` });
    row[field] = value.toFixed(2);
  }
  if (row.delivery_enabled && (row.business_latitude === null || row.business_longitude === null || Number(row.delivery_fee_per_km) <= 0 || Number(row.delivery_max_distance_km) <= 0)) {
    return res.status(400).json({ error: 'To enable delivery, enter the shop map pin, a per-kilometre fee, and a maximum delivery distance.' });
  }
  if (row.delivery_enabled && !process.env.GOOGLE_MAPS_ROUTES_API_KEY) return res.status(400).json({ error: 'Add GOOGLE_MAPS_ROUTES_API_KEY to the server .env before enabling delivery.' });
  if (row.gcash_enabled && !paymongo.isLiveModeConfigured()) return res.status(400).json({ error: 'Add the PayMongo sk_live_ secret key and the signing secret from the live webhook to the server .env before enabling GCash.' });
  if (row.gcash_enabled && !paymongoCheckoutReady()) return res.status(400).json({ error: 'Set APP_BASE_URL to your public HTTPS website origin before enabling live GCash.' });
  row.delivery_fee = row.delivery_base_fee;
  row.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('business_settings').update(row).eq('id', true).select('*').single();
  if (error) throw error;
  res.json({ settings: data, message: 'Business settings saved.' });
}));

app.get('/api/admin/reports', requireAdmin, asyncRoute(async (_req, res) => {
  const { data, error } = await supabase.rpc('admin_sales_report');
  if (error) throw error;
  res.json({ report: data });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use(asyncRoute(async (req, res, next) => {
  if (!/^\/admin\/(dashboard|products|orders|payments|reports|settings)\.html$/.test(req.path)) return next();
  const match = String(req.headers.cookie || '').match(/(?:^|;\s*)admin_access=([^;]+)/);
  if (!match) return res.redirect('/admin/login.html');
  const { data: authData, error: authError } = await supabase.auth.getUser(decodeURIComponent(match[1]));
  if (authError || !authData?.user) return res.redirect('/admin/login.html');
  const { data: profile, error: profileError } = await supabase.from('admin_profiles').select('id,role').eq('id', authData.user.id).maybeSingle();
  if (profileError || !profile || !['admin', 'owner'].includes(profile.role)) return res.redirect('/admin/login.html');
  next();
}));
app.use(express.static(publicDir, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

app.use((err, _req, res, _next) => {
  // Keep backend credentials, SQL details, and stack traces out of API responses.
  const uploadTooLarge = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
  const uploadError = err instanceof multer.MulterError;
  const status = uploadTooLarge ? 413 : uploadError ? 400 : Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500;
  console.error('Request failed:', status === 500 ? (err?.message || err) : 'Client request rejected');
  const message = uploadTooLarge ? 'The photo must be 5 MB or smaller.' : status === 500 ? 'Something went wrong. Please try again.' : (err.message || 'Request failed.');
  res.status(status).json({ error: message });
});

module.exports = app;
