import { isAdmin, redis, sendEmail, inviteEmail } from './_lib.js';

export default async function handler(req, res) {
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }

  // On récupère l'e-mail passé dans l'URL (ex: ?email=pote@example.com)
  const emailQuery = String(req.query?.email || '').trim().toLowerCase();
  if (!emailQuery) {
    return res.status(400).json({ error: 'Indique l\'e-mail avec ?email=mon_pote@gmail.com' });
  }

  try {
    const orderKeys = await redis.keys('order:*');
    let targetOrder = null;

    // On cherche la commande associée à cet e-mail
    for (const key of orderKeys) {
      const ord = await redis.get(key);
      if (ord && ord.email && ord.email.toLowerCase() === emailQuery) {
        targetOrder = ord;
        break; // On prend la dernière ou la première trouvée pour cet e-mail
      }
    }

    if (!targetOrder) {
      return res.status(404).json({ error: 'Aucune commande trouvée pour cet e-mail.' });
    }

    // On réinitialise l'avis
    targetOrder.reviewed = false;
    targetOrder.invited = false;
    await redis.set(`order:${targetOrder.id}`, targetOrder);

    // On lui renvoie l'e-mail d'invitation tout propre
    await sendEmail({
      to: targetOrder.email,
      ...inviteEmail(targetOrder)
    });

    return res.json({ 
      success: true, 
      message: `C'est fait ! Un nouveau lien d'avis a été renvoyé à ${targetOrder.email} (Commande ${targetOrder.orderNumber}).` 
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
