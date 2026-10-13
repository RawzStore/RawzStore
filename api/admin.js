import { stripe, redis, ensureOrder, isAdmin, sendEmailBatch, inviteEmail } from './_lib.js';

// Utilisation (dans le navigateur) :
//   /api/admin?key=TON_ADMIN_SECRET&action=sync                    -> importe les anciennes commandes payées
//   /api/admin?key=...&action=invite                               -> SIMULATION : liste qui recevrait le mail
//   /api/admin?key=...&action=invite&to=toi@mail.com&confirm=1     -> envoie à une seule adresse (test)
//   /api/admin?key=...&action=invite&confirm=1                     -> envoie à tous (une seule fois par commande)
//   /api/admin?key=...&action=hide&id=XXXX   (ou action=show)      -> masquer / republier un avis

export default async function handler(req, res) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  const { action, id, confirm, to } = req.query;

  try {
    if (action === 'sync') {
      let created = 0;
      let skipped = 0;
      for await (const s of stripe.checkout.sessions.list({ limit: 100 })) {
        if (s.status !== 'complete' || s.payment_status !== 'paid') continue;
        if (await redis.get(`order:${s.id}`)) {
          skipped++;
          continue;
        }
        await ensureOrder(s, { thankYouSent: true }); // pas de mail de remerciement rétroactif
        created++;
      }
      return res.status(200).json({ created, already_known: skipped });
    }

    if (action === 'invite') {
      const ids = await redis.smembers('orders');
      if (!ids.length) return res.status(200).json({ will_send: 0 });
      const orders = (await redis.mget(...ids.map((i) => `order:${i}`))).filter(Boolean);
      const only = to ? String(to).toLowerCase() : '';
      const todo = orders.filter(
        (o) => o.email && o.productIds.length && !o.invited && !o.reviewed && (!only || o.email.toLowerCase() === only)
      );

      if (confirm !== '1') {
        return res.status(200).json({ dry_run: true, will_send: todo.length, to: todo.map((o) => o.email) });
      }

      let sent = 0;
      for (let i = 0; i < todo.length; i += 50) {
        const chunk = todo.slice(i, i + 50);
        await sendEmailBatch(chunk.map((o) => ({ to: o.email, ...inviteEmail(o) })));
        for (const o of chunk) {
          o.invited = true;
          o.invitedAt = Date.now();
          await redis.set(`order:${o.id}`, o);
          sent++;
        }
      }
      return res.status(200).json({ sent });
    }

    if (action === 'hide' || action === 'show') {
      const review = id ? await redis.get(`review:${id}`) : null;
      if (!review) return res.status(404).json({ error: 'Avis introuvable' });
      review.hidden = action === 'hide';
      await redis.set(`review:${id}`, review);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(`<p style="font-family:sans-serif">Avis ${review.hidden ? 'masqué' : 'republié'}.</p>`);
    }

    return res.status(400).json({ error: 'action inconnue : sync | invite | hide | show' });
  } catch (e) {
    console.error('Erreur /api/admin :', e);
    return res.status(500).json({ error: e.message });
  }
}
