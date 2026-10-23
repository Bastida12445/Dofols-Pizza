const crypto = require('node:crypto');

const API_ROOT = 'https://api.paymongo.com/v2';

function isLiveModeConfigured() {
  const secret = String(process.env.PAYMONGO_SECRET_KEY || '').trim();
  const webhookSecret = String(process.env.PAYMONGO_WEBHOOK_SECRET || '').trim();
  return secret.startsWith('sk_live_') && Boolean(webhookSecret);
}

function authorizationHeader() {
  const secret = String(process.env.PAYMONGO_SECRET_KEY || '').trim();
  if (!secret.startsWith('sk_live_')) throw new Error('PayMongo live mode requires a live secret key.');
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`;
}

function toCentavos(amount) {
  const value = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid PayMongo line item amount.');
  return value;
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail;
    const error = new Error(typeof detail === 'string' ? detail : 'The payment provider could not process the request.');
    error.status = response.status;
    throw error;
  }
  return payload?.data;
}

async function createCheckoutSession({ order, items, baseUrl }) {
  const lineItems = items.map((item) => ({
    name: `${item.product_name_snapshot} (${item.size_name_snapshot})`,
    amount: toCentavos(item.unit_price_snapshot),
    currency: 'PHP',
    quantity: Number(item.quantity)
  }));
  if (Number(order.delivery_fee) > 0) {
    lineItems.push({ name: 'Distance-based delivery fee', amount: toCentavos(order.delivery_fee), currency: 'PHP', quantity: 1 });
  }
  if (!lineItems.length) throw new Error('Cannot create an empty GCash checkout.');

  const orderQuery = `?payment=success&order=${encodeURIComponent(order.order_number)}`;
  const cancelQuery = `?payment=cancelled&order=${encodeURIComponent(order.order_number)}`;
  const response = await fetch(`${API_ROOT}/checkout_sessions`, {
    method: 'POST',
    headers: {
      Authorization: authorizationHeader(),
      'Content-Type': 'application/json',
      'Idempotency-Key': `dofols-live-${order.id}`
    },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: lineItems,
          payment_method_types: ['gcash'],
          success_url: `${baseUrl}/order-confirmation.html${orderQuery}`,
          cancel_url: `${baseUrl}/order-confirmation.html${cancelQuery}`,
          reference_number: order.order_number,
          send_email_receipt: false,
          show_description: true,
          show_line_items: true,
          description: `Dofol's Freshly Baked Pizza order ${order.order_number}`,
          metadata: { dofols_order_id: order.id, dofols_order_number: order.order_number }
        }
      }
    })
  });
  const session = await parseResponse(response);
  const checkoutUrl = session?.attributes?.checkout_url;
  const url = typeof checkoutUrl === 'string' ? new URL(checkoutUrl) : null;
  if (session?.attributes?.livemode !== true) {
    const error = new Error('PayMongo did not create a live-mode checkout session.');
    error.status = 502;
    throw error;
  }
  if (!session?.id || !url || url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com') {
    throw new Error('The payment provider returned an invalid checkout session.');
  }
  return { id: session.id, url: url.toString() };
}

async function retrieveCheckoutSession(sessionId) {
  const response = await fetch(`${API_ROOT}/checkout_sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: authorizationHeader() },
    signal: AbortSignal.timeout(12000)
  });
  return parseResponse(response);
}

function verifyWebhook(rawBody, signatureHeader, webhookSecret, livemode) {
  if (!Buffer.isBuffer(rawBody) || typeof signatureHeader !== 'string' || !webhookSecret) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? ['', ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  const timestamp = parts.t;
  const supplied = livemode ? parts.li : parts.te;
  if (!/^\d+$/.test(timestamp || '') || !/^[a-f0-9]{64}$/i.test(supplied || '')) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.`).update(rawBody).digest();
  const received = Buffer.from(supplied, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function extractPaidPayment(session) {
  const attrs = session?.attributes || {};
  const payment = (attrs.payments || []).find((item) => item?.attributes?.status === 'paid');
  if (!payment) return null;
  return {
    id: payment.id,
    amount: Number(payment.attributes.amount),
    currency: payment.attributes.currency,
    status: payment.attributes.status
  };
}

module.exports = { isLiveModeConfigured, createCheckoutSession, retrieveCheckoutSession, verifyWebhook, extractPaidPayment };
