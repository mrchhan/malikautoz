/*
 * Paste into index.html (the Malik Autoz app), then add a button in Inventory that calls:
 *     exportPublicCatalog(<your products array>)
 * It downloads catalog.json. Commit that file next to catalog.html and Vercel publishes it.
 *
 * Only the fields listed in toPublicItem() are exported, so cost price, supplier and
 * customer data can never leak into the public file. Adjust the fallbacks on the
 * right-hand side of each `??` to match your real product field names.
 */
function toPublicItem(p){
  const price = Number(p.salePrice ?? p.sellPrice ?? p.price ?? p.retailPrice);
  const stock = Number(p.stock ?? p.qty ?? p.quantity ?? 0);
  return {
    id: String(p.id ?? p.productId),
    name: String(p.name || '').trim(),
    models: String(p.model || '').split(/[,;|\/]/).map(s => s.trim()).filter(Boolean),
    company: p.company || '',
    category: p.category || '',
    grade: p.grade || '',                  // e.g. Original / Imported / Local
    code: p.code || p.sku || '',
    price: isFinite(price) && price > 0 ? Math.round(price) : null,
    stock: isFinite(stock) ? Math.min(20, Math.max(0, Math.floor(stock))) : 0,  // capped at 20 so exact stock stays private
    image: p.image || ''                   // URL or path such as img/CD70-piston.webp; empty is fine
  };
}

function exportPublicCatalog(products){
  const items = products
    .filter(p => p && p.name && !p.hideOnline)   // set p.hideOnline = true to keep a product off the website
    .map(toPublicItem);
  const json = JSON.stringify({ updated: new Date().toISOString(), items }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = 'catalog.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
