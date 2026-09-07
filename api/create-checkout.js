import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const productsCatalog = [
  { id: 1, name: "Chemise à Carreaux", price: 1999 },
  { id: 2, name: "Polo Rayures", price: 1799 },
  { id: 3, name: "Polo Baggy Court", price: 1799 },
  { id: 4, name: "T-Shirt Tricoté", price: 2499 },
  { id: 5, name: "Short Double Layer", price: 2499 }
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Méthode non autorisée' });

  try {
    const bodyData = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { cart, deliveryMode, promoCode, email, customerDetails } = bodyData || {};

    if (!cart || !Array.isArray(cart) || cart.length === 0) {
      return res.status(400).json({ error: 'Panier invalide' });
    }

    // 1. Calcul des articles pour Stripe
    const lineItems = cart.map(item => {
      const dbProduct = productsCatalog.find(p => p.id === Number(item.id));
      const priceInCents = dbProduct ? dbProduct.price : 1999;
      const productName = dbProduct ? dbProduct.name : (item.name || `Article #${item.id}`);

      // Variantes (Taille / Couleur)
      const variantDetails = [];
      if (item.selectedSize) variantDetails.push(`Taille: ${item.selectedSize}`);
      if (item.selectedColor) variantDetails.push(`Coloris: ${item.selectedColor}`);
      const descriptionText = variantDetails.length > 0 ? variantDetails.join(' | ') : 'Taille unique';

      return {
        price_data: {
          currency: 'eur',
          product_data: { 
            name: productName,
            description: descriptionText
          },
          unit_amount: promoCode === "RAWZ10" ? Math.round(priceInCents * 0.90) : priceInCents,
        },
        quantity: item.quantity || 1,
      };
    });

    // 2. Frais de port
    let shippingCost = 0;
    if (deliveryMode === 'Mondial Relay') shippingCost = 390;
    if (deliveryMode && deliveryMode.includes('Colissimo')) shippingCost = 950;

    if (shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: `Livraison (${deliveryMode})` },
          unit_amount: shippingCost,
        },
        quantity: 1,
      });
    }

    // 3. Formatage de la liste des articles pour les métadonnées
    const articlesFormatted = cart.map(item => {
      const dbProduct = productsCatalog.find(p => p.id === Number(item.id));
      const pName = dbProduct ? dbProduct.name : (item.name || `Article #${item.id}`);
      const priceUnit = dbProduct ? (dbProduct.price / 100).toFixed(2) : "19.99";
      
      const details = [];
      if (item.selectedSize) details.push(`Taille: ${item.selectedSize}`);
      if (item.selectedColor) details.push(`Coloris: ${item.selectedColor}`);
      
      return `- ${pName} | ${details.join(' | ')} | Qte: ${item.quantity || 1} | Prix: ${priceUnit}€`;
    }).join(' -- ');

    // 4. Métadonnées ordonnées pour l'affichage Stripe
    const orderMetadata = {
      "1_Prenom": customerDetails?.firstname || 'Non renseigné',
      "2_Nom": customerDetails?.lastname || 'Non renseigné',
      "3_Email": email || customerDetails?.email || 'Non renseigné',
      "4_Telephone": customerDetails?.phone || 'Non renseigné',
      "5_Adresse": customerDetails?.address || 'Non renseignée',
      "6_Code_Postal": customerDetails?.zipcode || 'Non renseigné',
      "7_Ville": customerDetails?.city || 'Non renseignée',
      "8_Mode_de_Livraison": deliveryMode || 'Non renseigné',
      "9_Point_Relais": customerDetails?.relayInfo || 'Non applicable',
      "10_Articles_Commandes": articlesFormatted
    };

    // 5. Création de la session de paiement Stripe
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      customer_email: email || customerDetails?.email || undefined,

      payment_intent_data: {
        metadata: orderMetadata,
      },

      metadata: orderMetadata,

      success_url: 'https://rawz-store.vercel.app/?success=true',
      cancel_url: 'https://rawz-store.vercel.app/?cancel=true',
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Erreur Stripe :", error);
    return res.status(500).json({ error: error.message });
  }
}
