// Affiche les avis dans <section id="reviews-section" class="reviews-section" hidden></section>
// - Accueil : tous les avis
// - Fiche produit (product.html?id=2) : avis des clients qui ont acheté ce produit
(function () {
  function init() {
    var section = document.getElementById('reviews-section');
    if (!section) return;

    var pid = new URLSearchParams(location.search).get('id');
    var url = '/api/reviews' + (pid ? '?product=' + encodeURIComponent(pid) : '');

    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.count) return; // aucun avis : la section reste cachée
        render(section, data);
        section.hidden = false;
      })
      .catch(function () {});
  }

  function stars(n) { return '★'.repeat(n) + '☆'.repeat(5 - n); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // textContent : aucun risque d'injection HTML
    return e;
  }

  function render(section, data) {
    section.innerHTML = '';
    section.appendChild(el('h2', '', 'Avis clients'));

    var summary = el('div', 'reviews-summary');
    summary.appendChild(el('span', 'review-stars', stars(Math.round(data.average))));
    summary.appendChild(el('strong', '', String(data.average).replace('.', ',') + '/5'));
    summary.appendChild(el('span', 'reviews-count', data.count + (data.count > 1 ? ' avis' : ' avis')));
    section.appendChild(summary);

    section.appendChild(el('p', 'reviews-note',
      'Avis vérifiés : seuls les clients ayant passé commande reçoivent un lien pour en déposer un. Ils sont publiés tels quels.'));

    var list = el('div', 'reviews-list');
    data.reviews.forEach(function (r) {
      var card = el('article', 'review-card');
      var head = el('div', 'review-head');
      head.appendChild(el('strong', '', r.name));
      head.appendChild(el('span', 'review-stars', stars(r.rating)));
      card.appendChild(head);
      card.appendChild(el('p', 'review-text', r.comment));

      var meta = [];
      if (r.products && r.products.length) meta.push(r.products.join(', '));
      meta.push(new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }));
      card.appendChild(el('small', 'review-meta', meta.join(' · ')));
      list.appendChild(card);
    });
    section.appendChild(list);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
