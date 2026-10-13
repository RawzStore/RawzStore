import { redis } from './_lib.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  try {
    const pid = Number(req.query.product) || 0;
    const ids = await redis.zrange('reviews', 0, 99, { rev: true });
    if (!ids.length) return res.status(200).json({ count: 0, average: 0, reviews: [] });

    const all = (await redis.mget(...ids.map((i) => `review:${i}`))).filter((r) => r && !r.hidden);
    const list = pid ? all.filter((r) => (r.productIds || []).includes(pid)) : all;
    const average = list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : 0;

    return res.status(200).json({
      count: list.length,
      average: Math.round(average * 10) / 10,
      // Champs publics uniquement : ni e-mail, ni numéro de commande
      reviews: list.map((r) => ({
        name: r.name,
        rating: r.rating,
        comment: r.comment,
        products: r.products,
        date: r.createdAt,
      })),
    });
  } catch (e) {
    console.error('Erreur /api/reviews :', e);
    return res.status(500).json({ count: 0, average: 0, reviews: [] });
  }
}
