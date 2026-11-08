import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const productsCatalog = [
  { id: 1, name: "Chemise à Carreaux", price: 1999 },
  { id: 2, name: "Polo Rayures", price: 1799 },
  { id: 3, name: "Jogging Baggy Grey", price: 3499 },
  { id: 4, name: "Short Double Layer", price: 2499 },
  { id: 5, name: "T-Shirt Tricoté", price: 2499 }
];

// Code promo RAWZ10 : doit rester synchronisé avec script.js.
// Il est désactivé sur le site (code commenté dans script.js) : passe à true UNIQUEMENT quand tu le réactives aussi là-bas.
const PROMO_RAWZ10_ACTIVE = false;

// Frais de port (en centimes). Les clés sont exactement les valeurs des boutons radio du site.
const SHIPPING_COSTS = {
  'Mondial Relay': 390,
  'Colissimo Domicile': 950,
  'Remise en main propre': 0
};
const FREE_SHIPPING_FROM = 12000; // 120 € (après remise), comme annoncé sur le site

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

    if (!Object.prototype.hasOwnProperty.call(SHIPPING_COSTS, deliveryMode)) {
      return res.status(400).json({ error: 'Mode de livraison invalide' });
    }

    // 0. Validation du panier : on ne fait confiance qu'au catalogue du serveur (prix ET nom)
    const items = [];
    for (const item of cart) {
      const product = productsCatalog.find(p => p.id === Number(item.id));
      if (!product) {
        return res.status(400).json({ error: `Produit introuvable (id ${item.id})` });
      }
      const quantity = item.quantity === undefined ? 1 : Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        return res.status(400).json({ error: 'Quantité invalide' });
      }
      items.push({
        product,
        quantity,
        selectedSize: item.selectedSize,
        selectedColor: item.selectedColor
      });
    }

    const promoApplied = PROMO_RAWZ10_ACTIVE && promoCode === "RAWZ10";

    // 1. Calcul des articles pour Stripe
    let subtotalCents = 0;
    const lineItems = items.map(({ product, quantity, selectedSize, selectedColor }) => {
      // Variantes (Taille / Couleur)
      const variantDetails = [];
      if (selectedSize) variantDetails.push(`Taille: ${selectedSize}`);
      if (selectedColor) variantDetails.push(`Coloris: ${selectedColor}`);
      const descriptionText = variantDetails.length > 0 ? variantDetails.join(' | ') : 'Taille unique';

      const unitAmount = promoApplied ? Math.round(product.price * 0.90) : product.price;
      subtotalCents += unitAmount * quantity;

      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: product.name,
            description: descriptionText
          },
          unit_amount: unitAmount,
        },
        quantity,
      };
    });

    // 2. Frais de port (offerts dès 120 € de produits, après remise)
    const shippingCost = subtotalCents >= FREE_SHIPPING_FROM ? 0 : SHIPPING_COSTS[deliveryMode];

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
    const articlesFormatted = items.map(({ product, quantity, selectedSize, selectedColor }) => {
      const priceUnit = (product.price / 100).toFixed(2);

      const details = [];
      if (selectedSize) details.push(`Taille: ${selectedSize}`);
      if (selectedColor) details.push(`Coloris: ${selectedColor}`);

      return `- ${product.name} | ${details.join(' | ')} | Qte: ${quantity} | Prix: ${priceUnit}€`;
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
      "8_Mode_de_Livraison": deliveryMode,
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

      success_url: 'https://rawz.store/merci.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://rawz.store/?cancel=true',
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("Erreur Stripe :", error);
    return res.status(500).json({ error: error.message });
  }
}
