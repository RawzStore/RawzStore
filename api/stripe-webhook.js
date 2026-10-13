import { stripe, redis, ensureOrder, sendEmail, thankYouEmail } from './_lib.js';

// Stripe signe le corps brut : il ne faut surtout pas le parser avant la vérification
export const config = { api: { bodyParser: false } };

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      await readRaw(req),
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    return res.status(400).send(`Signature invalide : ${e.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid') {
      try {
        const order = await ensureOrder(session);
        // Idempotent : si Stripe rappelle le webhook, le mail ne part qu'une fois
        if (!order.thankYouSent && order.email) {
          await sendEmail({ to: order.email, ...thankYouEmail(order) });
          order.thankYouSent = true;
          await redis.set(`order:${session.id}`, order);
        }
      } catch (e) {
        console.error('Webhook erreur :', e);
        return res.status(500).send('Erreur'); // Stripe réessaiera automatiquement
      }
    }
  }

  return res.status(200).json({ received: true });
}
