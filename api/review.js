import crypto from 'node:crypto';
import { redis, esc, getOrderByToken, sendEmail, OWNER_EMAIL, SITE } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // 1) La page avis.html vérifie que le lien est valide
    if (req.method === 'GET') {
      const order = await getOrderByToken(req.query.token);
      if (!order) return res.status(404).json({ valid: false });
      return res.status(200).json({
        valid: true,
        used: !!order.reviewed,
        firstname: order.firstname,
        products: order.articles.map((a) => a.name),
      });
    }

    // 2) Envoi de l'avis
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const token = String(body.token || '');
      const order = await getOrderByToken(token);
      if (!order) return res.status(404).json({ error: 'Lien invalide.' });

      const rating = parseInt(body.rating, 10);
      const comment = String(body.comment || '').trim();
      const name = String(body.name || order.firstname || '').trim().slice(0, 30);
      if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Choisis une note de 1 à 5.' });
      if (comment.length < 10 || comment.length > 1000)
        return res.status(400).json({ error: 'Ton commentaire doit faire entre 10 et 1000 caractères.' });
      if (name.length < 2) return res.status(400).json({ error: 'Indique un prénom ou un pseudo.' });

      // Usage unique : seul le premier envoi passe (verrou atomique)
      const claimed = await redis.set(`used:${token}`, 1, { nx: true });
      if (!claimed) return res.status(409).json({ error: 'Ce lien a déjà été utilisé.' });

      try {
        const id = crypto.randomBytes(8).toString('hex');
        const review = {
          id,
          name,
          rating,
          comment,
          orderNumber: order.orderNumber, // privé, jamais renvoyé au public
          productIds: order.productIds,
          products: order.articles.map((a) => a.name),
          createdAt: Date.now(),
          hidden: false,
        };
        await redis.set(`review:${id}`, review);
        await redis.zadd('reviews', { score: review.createdAt, member: id });
        order.reviewed = true;
        await redis.set(`order:${order.id}`, order);

        // Alerte pour toi, avec un lien "masquer" en un clic (en cas d'insultes uniquement)
        try {
          const hide = `${SITE}/api/admin?action=hide&id=${id}&key=${encodeURIComponent(process.env.ADMIN_SECRET || '')}`;
          await sendEmail({
            to: OWNER_EMAIL,
            subject: `Nouvel avis ${'★'.repeat(rating)} — ${order.orderNumber}`,
            html: `<p><strong>${esc(name)}</strong> — ${rating}/5</p><p>${esc(comment)}</p><p style="color:#777">Commande ${order.orderNumber}</p><p><a href="${hide}">Masquer cet avis</a> (réservé aux propos injurieux ou illégaux)</p>`,
          });
        } catch (e) {
          console.error('Notif avis :', e);
        }

        return res.status(200).json({ ok: true });
      } catch (e) {
        await redis.del(`used:${token}`); // on libère le lien si l'enregistrement a échoué
        throw e;
      }
    }

    return res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error('Erreur /api/review :', e);
    return res.status(500).json({ error: 'Erreur serveur, réessaie dans un instant.' });
  }
}
