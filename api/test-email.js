import { isAdmin, sendEmail, thankYouEmail, inviteEmail, OWNER_EMAIL } from './_lib.js'; // Ajuste le chemin vers ton fichier _lib.js si besoin

export default async function handler(req, res) {
  // On vérifie que c'est bien toi grâce à ta clé admin
  if (!isAdmin(req)) {
    return res.status(401).json({ error: 'Non autorisé. Ajoute ?key=TA_CLE_ADMIN dans l\'URL.' });
  }

  // Fausse commande de test
  const fakeOrder = {
    orderNumber: 'RAWZ-TEST1234',
    firstname: 'Thomas',
    email: OWNER_EMAIL, // L'e-mail sera envoyé à ton adresse
    delivery: 'Mondial Relay',
    total: 45.00,
    articles: [
      { name: 'Chemise à Carreaux', details: 'Noir · Taille L' }
    ],
    token: '1234567890abcdef1234567890abcdef1234567890abcdef'
  };

  try {
    // 1. Envoi du test pour l'e-mail de confirmation de commande
    await sendEmail({
      to: fakeOrder.email,
      ...thankYouEmail(fakeOrder)
    });

    // 2. Envoi du test pour l'e-mail d'avis
    await sendEmail({
      to: fakeOrder.email,
      ...inviteEmail(fakeOrder)
    });

    return res.status(200).json({ 
      success: true, 
      message: `E-mails de test envoyés avec succès à ${fakeOrder.email} ! Vérifie ta boîte mail.` 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
