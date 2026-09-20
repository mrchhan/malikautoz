/*
 * Malik Autoz - Online Catalog tools
 *
 * Add-on for index.html. Load it with ONE line just before </body>:
 *     <script src="catalog-tools.js"></script>
 *
 * What it adds (all created from here, nothing else in index.html changes):
 *   1. An "Online Catalog" tile in Dashboard > Quick Access (Manager and Admin).
 *   2. A "Publish online catalog" button above the Product Catalog in Inventory.
 *   3. A popup with the customer link, a Copy button, and a Download button that
 *      builds catalog.json from your real products.
 *
 * Privacy: catalog.json only ever contains the whitelisted fields in toPublicItem()
 * below. Cost price, wholesale price, supplier and customer data are never read.
 */
(function () {
  'use strict';
  if (window.__catalogToolsLoaded) return;
  window.__catalogToolsLoaded = true;

  var CFG = {
    publicBase: 'https://malikautoz-shop.pages.dev',
    catalogPath: '/',
    githubUploadUrl: 'https://github.com/mrchhangmail/malikautoz-shop/upload/main',
    maxStockShown: 20          // exact stock stays private; anything above this shows as this
  };

  /* ---------- text (English + Urdu), registered into the app's own TRANSLATIONS ---------- */
  var EN = {
    title: '🌐 Online Catalog',
    intro: 'Publish your parts list as a public web page customers can browse and order from on WhatsApp. Only name, bike fitment, brand, retail price and a capped stock level are shared. Cost prices, wholesale prices, suppliers and customers never leave this app.',
    shareLink: 'Link to share with customers',
    copyLink: '📋 Copy link',
    openPage: '🔗 Open page',
    copied: 'Link copied.',
    copyFailed: 'Could not copy automatically. The link is selected, press Ctrl+C.',
    includeOutOfStock: 'Include out-of-stock parts (shown as "Out of stock")',
    includeNoPrice: 'Include parts with no retail price (shown as "Ask for price")',
    summary: '{n} of {total} products will be published.',
    noModel: 'Parts without a bike model ({n}) will show under every bike. Add a Model in Inventory to fix that.',
    noProducts: 'There are no products to publish yet. Add products in Inventory first.',
    download: '⬇️ Download catalog.json',
    downloaded: 'catalog.json downloaded ({n} products). Upload it to GitHub to publish it.',
    stepsTitle: 'To publish the download',
    step1: 'Click Download above.',
    step2: 'Open the GitHub upload page, drop catalog.json in, and click Commit changes.',
    step3: 'Wait about a minute. The customer page updates by itself.',
    openGithub: 'Open GitHub upload page',
    publishBtn: '🌐 Publish online catalog'
  };
  var UR = {
    title: '🌐 آن لائن کیٹلاگ',
    intro: 'اپنے پرزوں کی فہرست ایک عوامی ویب پیج کے طور پر شائع کریں جسے کسٹمرز دیکھ کر واٹس ایپ پر آرڈر کر سکیں۔ صرف نام، بائیک فٹمنٹ، برانڈ، ریٹیل قیمت اور محدود اسٹاک لیول شیئر ہوتا ہے۔ لاگت، ہول سیل قیمت، سپلائرز اور کسٹمرز کی معلومات اس ایپ سے باہر نہیں جاتیں۔',
    shareLink: 'کسٹمرز کے ساتھ شیئر کرنے کا لنک',
    copyLink: '📋 لنک کاپی کریں',
    openPage: '🔗 صفحہ کھولیں',
    copied: 'لنک کاپی ہو گیا۔',
    copyFailed: 'خودکار کاپی نہیں ہو سکا۔ لنک منتخب ہے، Ctrl+C دبائیں۔',
    includeOutOfStock: 'اسٹاک ختم پرزے بھی شامل کریں ("اسٹاک ختم" کے طور پر دکھائے جاتے ہیں)',
    includeNoPrice: 'بغیر ریٹیل قیمت والے پرزے بھی شامل کریں ("قیمت پوچھیں" کے طور پر دکھائے جاتے ہیں)',
    summary: '{total} میں سے {n} پروڈکٹس شائع ہوں گی۔',
    noModel: 'بائیک ماڈل کے بغیر پرزے ({n}) ہر بائیک کے تحت دکھائی دیں گے۔ اسے ٹھیک کرنے کے لیے انوینٹری میں ماڈل شامل کریں۔',
    noProducts: 'ابھی شائع کرنے کے لیے کوئی پروڈکٹ نہیں۔ پہلے انوینٹری میں پروڈکٹس شامل کریں۔',
    download: '⬇️ catalog.json ڈاؤن لوڈ کریں',
    downloaded: 'catalog.json ڈاؤن لوڈ ہو گئی ({n} پروڈکٹس)۔ شائع کرنے کے لیے اسے گِٹ ہب پر اپ لوڈ کریں۔',
    stepsTitle: 'ڈاؤن لوڈ شدہ فائل شائع کرنے کے لیے',
    step1: 'اوپر ڈاؤن لوڈ پر کلک کریں۔',
    step2: 'گِٹ ہب اپ لوڈ پیج کھولیں، catalog.json ڈالیں اور Commit changes پر کلک کریں۔',
    step3: 'تقریباً ایک منٹ انتظار کریں۔ کسٹمر پیج خود اپڈیٹ ہو جاتا ہے۔',
    openGithub: 'گِٹ ہب اپ لوڈ پیج کھولیں',
    publishBtn: '🌐 آن لائن کیٹلاگ شائع کریں'
  };

  function registerText() {
    if (typeof TRANSLATIONS === 'undefined') return;
    TRANSLATIONS.en.catalog = EN;
    TRANSLATIONS.ur.catalog = UR;
    if (TRANSLATIONS.en.navigation) TRANSLATIONS.en.navigation.onlineCatalog = 'Online Catalog';
    if (TRANSLATIONS.ur.navigation) TRANSLATIONS.ur.navigation.onlineCatalog = 'آن لائن کیٹلاگ';
  }
  function tx(key, vars) {
    // Falls back to English if the app's translator isn't available for any reason.
    if (typeof t === 'function') return t('catalog.' + key, vars);
    var s = EN[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  /* ---------- catalog data (whitelist only) ---------- */
  function toPublicItem(p) {
    var price = Number(p.priceRetail);
    var stock = Number(p.stock);
    return {
      id: String(p.id),
      name: String(p.name || '').trim(),
      models: String(p.model || '').split(/[,;|\/]/).map(function (s) { return s.trim(); }).filter(Boolean),
      company: p.company ? String(p.company).trim() : '',
      category: p.category ? String(p.category) : '',
      code: p.sku ? String(p.sku) : '',
      price: isFinite(price) && price > 0 ? Math.round(price) : null,
      stock: isFinite(stock) ? Math.min(CFG.maxStockShown, Math.max(0, Math.floor(stock))) : 0,
      image: p.image ? String(p.image) : ''
    };
  }

  function buildCatalog(opts) {
    opts = opts || {};
    var all = (typeof products !== 'undefined' && Array.isArray(products)) ? products : [];
    var items = all
      .filter(function (p) { return p && p.name; })
      .filter(function (p) { return opts.includeOutOfStock || Number(p.stock) > 0; })
      .filter(function (p) { return opts.includeNoPrice || Number(p.priceRetail) > 0; })
      .map(toPublicItem);
    return {
      total: all.length,
      published: items.length,
      noModel: items.filter(function (i) { return i.models.length === 0; }).length,
      payload: { updated: new Date().toISOString(), items: items }
    };
  }

  function currentOptions() {
    var oos = document.getElementById('catalogIncludeOos');
    var np = document.getElementById('catalogIncludeNoPrice');
    return { includeOutOfStock: oos ? oos.checked : true, includeNoPrice: np ? np.checked : false };
  }

  /* ---------- popup ---------- */
  function catalogUrl() { return CFG.publicBase + CFG.catalogPath; }

  function injectModal() {
    if (document.getElementById('catalogModal')) return;
    var html =
      '<div class="modal-bg hidden" id="catalogModal">' +
      '  <div class="modal" style="max-width:500px;">' +
      '    <h2 style="margin-top:0;color:var(--primary);" data-i18n="catalog.title">' + EN.title + '</h2>' +
      '    <p style="font-size:12px;color:var(--muted);margin-top:-6px;" data-i18n="catalog.intro">' + EN.intro + '</p>' +
      '    <label data-i18n="catalog.shareLink">' + EN.shareLink + '</label>' +
      '    <input id="catalogLinkInput" readonly dir="ltr" style="margin-bottom:8px;">' +
      '    <div class="row" style="margin-bottom:12px;">' +
      '      <button type="button" class="btn ghost small" id="catalogCopyBtn" data-i18n="catalog.copyLink">' + EN.copyLink + '</button>' +
      '      <a class="btn ghost small" id="catalogOpenLink" target="_blank" rel="noopener" style="text-decoration:none;" data-i18n="catalog.openPage">' + EN.openPage + '</a>' +
      '    </div>' +
      '    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);margin-bottom:8px;">' +
      '      <input type="checkbox" id="catalogIncludeOos" checked style="width:auto;margin:0;flex:none;">' +
      '      <span data-i18n="catalog.includeOutOfStock">' + EN.includeOutOfStock + '</span></label>' +
      '    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text);margin-bottom:10px;">' +
      '      <input type="checkbox" id="catalogIncludeNoPrice" style="width:auto;margin:0;flex:none;">' +
      '      <span data-i18n="catalog.includeNoPrice">' + EN.includeNoPrice + '</span></label>' +
      '    <div class="changebox" id="catalogSummary"></div>' +
      '    <button type="button" class="btn accent" id="catalogDownloadBtn" style="width:100%;margin-top:10px;" data-i18n="catalog.download">' + EN.download + '</button>' +
      '    <div id="catalogStatus" style="font-size:12px;min-height:16px;margin-top:6px;"></div>' +
      '    <div style="font-size:13px;font-weight:600;margin-top:10px;" data-i18n="catalog.stepsTitle">' + EN.stepsTitle + '</div>' +
      '    <ol style="font-size:13px;padding-inline-start:20px;margin:6px 0 10px;">' +
      '      <li data-i18n="catalog.step1">' + EN.step1 + '</li>' +
      '      <li data-i18n="catalog.step2">' + EN.step2 + '</li>' +
      '      <li data-i18n="catalog.step3">' + EN.step3 + '</li>' +
      '    </ol>' +
      '    <div class="row">' +
      '      <a class="btn ghost small" id="catalogGithubLink" target="_blank" rel="noopener" style="text-decoration:none;" data-i18n="catalog.openGithub">' + EN.openGithub + '</a>' +
      '      <button type="button" class="btn ghost" style="flex:1;" id="catalogCloseBtn" data-i18n="common.close">Close</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', html);

    document.getElementById('catalogLinkInput').value = catalogUrl();
    document.getElementById('catalogOpenLink').setAttribute('href', catalogUrl());
    document.getElementById('catalogGithubLink').setAttribute('href', CFG.githubUploadUrl);
    document.getElementById('catalogCopyBtn').addEventListener('click', copyLink);
    document.getElementById('catalogDownloadBtn').addEventListener('click', downloadCatalog);
    document.getElementById('catalogCloseBtn').addEventListener('click', closePublisher);
    document.getElementById('catalogIncludeOos').addEventListener('change', refreshSummary);
    document.getElementById('catalogIncludeNoPrice').addEventListener('change', refreshSummary);
  }

  function setStatus(text, isError) {
    var el = document.getElementById('catalogStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--success)';
  }

  function refreshSummary() {
    var box = document.getElementById('catalogSummary');
    if (!box) return;
    var r = buildCatalog(currentOptions());
    var dl = document.getElementById('catalogDownloadBtn');
    if (r.total === 0) {
      box.textContent = tx('noProducts');
      box.classList.add('negative');
      if (dl) dl.disabled = true;
      return;
    }
    if (dl) dl.disabled = r.published === 0;
    var text = tx('summary', { n: r.published, total: r.total });
    if (r.noModel > 0) text += ' ' + tx('noModel', { n: r.noModel });
    box.textContent = text;
    box.classList.toggle('negative', r.noModel > 0);
  }

  function openPublisher() {
    if (typeof hasPermission === 'function' && !hasPermission('edit')) {
      if (typeof denyAccess === 'function') denyAccess();
      return;
    }
    injectModal();
    if (typeof applyTranslations === 'function') applyTranslations();
    setStatus('');
    refreshSummary();
    document.getElementById('catalogModal').classList.remove('hidden');
  }
  function closePublisher() {
    var m = document.getElementById('catalogModal');
    if (m) m.classList.add('hidden');
  }

  function copyLink() {
    var input = document.getElementById('catalogLinkInput');
    var url = input.value;
    function fallback() {
      input.focus(); input.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      setStatus(ok ? tx('copied') : tx('copyFailed'), !ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { setStatus(tx('copied')); }, fallback);
    } else { fallback(); }
  }

  function downloadCatalog() {
    var r = buildCatalog(currentOptions());
    if (r.published === 0) { setStatus(tx('noProducts'), true); return; }
    var json = JSON.stringify(r.payload, null, 1);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'catalog.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    setStatus(tx('downloaded', { n: r.published }));
  }

  /* ---------- wire into the existing app ---------- */
  function addTile() {
    var grid = document.getElementById('quickAccessGrid');
    if (!grid || grid.querySelector('[data-view="catalog"]')) return;
    var tile = document.createElement('button');
    tile.className = 'quick-tile';
    tile.setAttribute('data-view', 'catalog');
    tile.innerHTML = '<span class="quick-icon">🌐</span><span data-i18n="navigation.onlineCatalog">Online Catalog</span>';
    tile.addEventListener('click', openPublisher);
    var anchor = grid.querySelector('[data-view="socialInbox"]');
    if (anchor && anchor.nextSibling) grid.insertBefore(tile, anchor.nextSibling); else grid.appendChild(tile);
  }

  function addInventoryButton() {
    if (document.getElementById('catalogPublishBtn')) return;
    var h2 = document.querySelector('#view-inventory [data-i18n="inventory.productCatalog"]');
    if (!h2) return;
    var row = document.createElement('div');
    row.className = 'row';
    row.style.marginBottom = '8px';
    row.innerHTML = '<button type="button" class="btn ghost small" id="catalogPublishBtn" data-i18n="catalog.publishBtn">' + EN.publishBtn + '</button>';
    h2.parentNode.insertBefore(row, h2.nextSibling);
    document.getElementById('catalogPublishBtn').addEventListener('click', openPublisher);
  }

  function allowTileForRoles() {
    // The dashboard only shows tiles listed for the logged-in role. Cashiers and
    // mechanics do not get this one; it needs edit permission.
    try {
      ['manager', 'admin'].forEach(function (role) {
        var cfg = DASHBOARD_SECTIONS_BY_ROLE[role];
        if (cfg && cfg.tiles.indexOf('catalog') === -1) cfg.tiles.push('catalog');
      });
    } catch (e) { /* app structure changed; the Inventory button still works */ }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var m = document.getElementById('catalogModal');
      if (m && !m.classList.contains('hidden')) closePublisher();
    }
  });

  registerText();
  addTile();
  addInventoryButton();
  allowTileForRoles();
  if (typeof applyTranslations === 'function') applyTranslations();
  try { if (typeof renderDashboard === 'function') renderDashboard(); } catch (e) { /* not ready yet; it renders on login */ }

  window.openCatalogPublisher = openPublisher;
  window.buildOnlineCatalog = buildCatalog;   // handy for checking in the browser console
})();
