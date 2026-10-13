import Stripe from 'stripe';
import { Redis } from '@upstash/redis';
import crypto from 'node:crypto';

export const SITE = 'https://rawz.store';
export const OWNER_EMAIL = process.env.OWNER_EMAIL || 'rawz.store.instinct@gmail.com';
const MAIL_FROM = process.env.MAIL_FROM || 'RAWZ <commande@rawz.store>';

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Vercel + Upstash Redis (Marketplace) : les deux familles de variables sont gérées
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

// Nom du produit -> id (mêmes noms que dans create-checkout.js). Le ticket 99 n'est pas "avisable".
const CATALOG = {
  'Chemise à Carreaux': 1,
  'Polo Rayures': 2,
  'Jogging Baggy Grey': 3,
  'Short Double Layer': 4,
  'T-Shirt Tricoté': 5,
  'Ticket de Participation Jeu-Concours Rawz': 99,
};
const TICKET_ID = 99;

export const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function isAdmin(req) {
  const key = String(req.query?.key || '');
  const secret = process.env.ADMIN_SECRET || '';
  if (!secret || key.length !== secret.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret));
}

// Numéro de commande : dérivé de la session Stripe (pas de doublon, pas de base nécessaire).
// merci.html calcule exactement le même.
export const orderNumber = (sessionId) => 'RAWZ-' + String(sessionId).slice(-8).toUpperCase();

// Lit la ligne "10_Articles_Commandes" posée dans les metadata par create-checkout.js
function parseArticles(md = {}) {
  const raw = md['10_Articles_Commandes'] || '';
  return raw
    .split(' -- ')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean)
    .map((l) => {
      const parts = l.split(' | ').map((s) => s.trim());
      return { name: parts[0], details: parts.slice(1).filter((p) => !p.startsWith('Prix:')).join(' · ') };
    });
}

// Crée (une seule fois) la fiche commande + le jeton d'avis unique
export async function ensureOrder(session, { thankYouSent = false } = {}) {
  const key = `order:${session.id}`;
  const existing = await redis.get(key);
  if (existing) return existing;

  const md = session.metadata || {};
  const articles = parseArticles(md);
  const productIds = [...new Set(articles.map((a) => CATALOG[a.name]).filter((id) => id && id !== TICKET_ID))];
  const token = crypto.randomBytes(24).toString('hex'); // 48 caractères, impossible à deviner

  const order = {
    id: session.id,
    orderNumber: orderNumber(session.id),
    email: session.customer_details?.email || session.customer_email || md['3_Email'] || '',
    firstname: md['1_Prenom'] || '',
    delivery: md['8_Mode_de_Livraison'] || '',
    total: (session.amount_total || 0) / 100,
    articles,
    productIds,
    token,
    thankYouSent,
    invited: false,
    reviewed: false,
    createdAt: (session.created || 0) * 1000 || Date.now(),
  };

  const ok = await redis.set(key, order, { nx: true });
  if (!ok) return await redis.get(key); // créée entre-temps par un autre appel
  await redis.set(`token:${token}`, session.id);
  await redis.sadd('orders', session.id);
  return order;
}

export async function getOrderByToken(token) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null;
  const sessionId = await redis.get(`token:${token}`);
  if (!sessionId) return null;
  return await redis.get(`order:${sessionId}`);
}

// ---------- E-mails (Resend, API REST, aucune dépendance) ----------
async function resend(path, body) {
  const r = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}
const withDefaults = (m) => ({ from: MAIL_FROM, reply_to: OWNER_EMAIL, ...m });
export const sendEmail = (m) => resend('/emails', withDefaults(m));
export const sendEmailBatch = (arr) => resend('/emails/batch', arr.map(withDefaults));

const layout = (inner) => `<div style="background:#f4f4f2;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e5e0">
<div style="background:#000;text-align:center;padding:18px;">
  <a href="${SITE}" target="_blank">
    <img src="${SITE}/images/logo.png" alt="RAWZ" style="height:28px;display:block;margin:0 auto;border:0;">
  </a>
</div>
<div style="padding:24px;font-size:15px;line-height:1.6">${inner}</div>
<div style="padding:14px 24px;border-top:1px solid #eee;font-size:12px;color:#777">RAWZ · rawz.store · Une question ? Réponds simplement à cet e-mail.</div>
</div></div>`;

const hello = (o) => `Salut${o.firstname ? ' ' + esc(o.firstname) : ''},`;

export function thankYouEmail(o) {
  const rows = o.articles
    .map((a) => `<li style="margin-bottom:8px"><strong>${esc(a.name)}</strong><br><span style="color:#666;font-size:13px">${esc(a.details)}</span></li>`)
    .join('');
  const total = o.total.toFixed(2).replace('.', ',') + ' €';
  return {
    subject: `Merci pour ta commande ${o.orderNumber} — RAWZ`,
    html: layout(`
      <p>${hello(o)}</p>
      <p>Merci pour ta commande, elle est bien enregistrée et ton paiement est validé.</p>
      <p style="background:#f4f4f2;padding:12px 14px;margin:18px 0">
        <span style="font-size:12px;color:#666;letter-spacing:1px">NUMÉRO DE COMMANDE</span><br>
        <strong style="font-size:18px;letter-spacing:1px">${o.orderNumber}</strong>
      </p>
      <ul style="padding-left:18px">${rows}</ul>
      <p>Total payé : <strong>${total}</strong><br>Livraison : ${esc(o.delivery) || '—'}</p>
      <p>On te tient au courant par e-mail dès qu'il y a du nouveau. Garde ce numéro si tu as besoin de nous écrire.</p>
      <p>— L'équipe RAWZ</p>`),
  };
}

export function inviteEmail(o) {
  const link = `${SITE}/avis.html?token=${o.token}`;
  return {
    subject: 'Ton avis sur ta commande RAWZ ?',
    html: layout(`
      <p>${hello(o)}</p>
      <p>Ta commande <strong>${o.orderNumber}</strong> est passée entre tes mains, on espère qu'elle te plaît !</p>
      <p>Ça nous aiderait beaucoup que tu laisses ton avis (30 secondes). Le lien ci-dessous est personnel et ne fonctionne qu'une seule fois.</p>
      <p style="text-align:center;margin:26px 0"><a href="${link}" style="background:#000;color:#fff;text-decoration:none;padding:14px 26px;letter-spacing:2px;font-size:13px">LAISSER MON AVIS</a></p>
      <p style="font-size:12px;color:#777">Si le bouton ne marche pas : ${link}</p>
      <p>Merci,<br>— L'équipe RAWZ</p>`),
  };
}
