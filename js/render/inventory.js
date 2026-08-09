// ── Recipe editor ─────────────────────────────────────────────────────────
function renderRecipeEditor(item) {
  const lines = (item.recipe || []).map((l, i) => {
    const opts = state.raw.map(r =>
      `<option value="${r.id}" ${l.rawId === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`
    ).join('');
    const raw = rawById(l.rawId);
    return `<div class="recipe-line">
      <select onchange="updateRecipeLine('${item.id}',${i},'rawId',this.value)">${opts}</select>
      <input type="number" min="0" step="any" value="${l.qty}" onchange="updateRecipeLine('${item.id}',${i},'qty',this.value)">
      <span class="unit-label">${raw ? escapeHtml(raw.unit) : ''} / portion</span>
      <button onclick="removeRecipeLine('${item.id}',${i})">remove</button>
    </div>`;
  }).join('');

  const portions  = portionsPossible(item);
  const modeHint  = (portions !== null && !isAutoStock(item))
    ? `<div style="font-size:.8rem;margin-top:.4rem;">Stock is manual.
        <button style="font-size:.8rem;text-decoration:underline;border:none;background:none;color:var(--green-mid);padding:0;"
          onclick="setStockMode('${item.id}','auto')">Switch to auto — track from raw materials</button></div>`
    : '';

  const sourceOptions = state.menu.filter(m => m.id !== item.id && itemRecipe(m).length > 0);
  const autofillHtml  = sourceOptions.length ? `
    <div style="margin-top:.7rem;padding-top:.6rem;border-top:1px dashed var(--border);">
      <strong style="font-size:.78rem;">Auto-fill from another menu item</strong>
      <div class="recipe-line" style="margin-top:.4rem;">
        <select id="autofillSrc-${item.id}">
          ${sourceOptions.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}
        </select>
        <input type="number" min="0.01" step="any" value="1" id="autofillQty-${item.id}" title="Qty of that item per one portion of this combo">
        <span class="unit-label">× qty</span>
        <button onclick="addFromMenuItem('${item.id}', document.getElementById('autofillSrc-${item.id}').value, document.getElementById('autofillQty-${item.id}').value)">Add ingredients</button>
      </div>
      <div style="font-size:.72rem;color:var(--ink-soft);margin-top:.2rem;">One-time copy — editing the source later won't affect this combo.</div>
    </div>` : '';

  return `<div class="recipe-editor">
    <strong style="font-size:.82rem;">Recipe for ${escapeHtml(item.name)} (per 1 portion)</strong>
    <div style="margin:.5rem 0;">${lines || '<span style="font-size:.8rem;color:var(--ink-soft);">No ingredients yet.</span>'}</div>
    <button onclick="addRecipeLine('${item.id}')" style="font-size:.8rem;">+ Add ingredient</button>
    ${portions !== null ? `<div style="font-size:.8rem;margin-top:.5rem;" class="portions-badge ${portions <= 5 ? 'low' : ''}">Raw stock allows ~${portions} portion${portions === 1 ? '' : 's'}</div>` : ''}
    ${modeHint}
    ${autofillHtml}
  </div>`;
}

// ── Inventory & Menu tab ─────────────────────────────────────────────────
function renderInventoryTab() {
  const c = document.getElementById('inventoryContent');
  const catOptions = allKnownCategories().map(cat => `<option value="${escapeHtml(cat)}">`).join('');

  const rows = state.menu.map(m => {
    const recipeCount = itemRecipe(m).length;
    const portions    = portionsPossible(m);
    const portionsHtml = portions !== null
      ? `<div class="portions-badge ${portions <= 5 ? 'low' : ''}">~${portions} portions from raw</div>`
      : '';
    const auto  = isAutoStock(m);
    const avail = effectiveStock(m);

    const stockCell = auto
      ? `<span class="${avail <= m.threshold ? 'low' : ''}" style="font-family:'IBM Plex Mono',monospace;">${avail}</span> <span class="portions-badge">from raw</span>`
      : `<input type="number" min="0" value="${m.stock}" onchange="setStock('${m.id}', this.value)" title="Type a number to set exact stock">${m.unit ? (' ' + escapeHtml(m.unit)) : ''}`;

    const stockCtrl = auto
      ? `<span style="font-size:.74rem;color:var(--ink-soft);">buy raw materials to increase</span>`
      : `<div class="restock-ctrl">
           <input type="number" min="1" placeholder="Qty" id="restock-${m.id}">
           <button onclick="restock('${m.id}', +document.getElementById('restock-${m.id}').value)">+ Add</button>
         </div>`;

    const mainRow = `<tr class="inv-row">
      <td data-label="Name"><input class="wide" value="${escapeHtml(m.name)}" onchange="updateMenuItem('${m.id}','name',this.value)">${portionsHtml}</td>
      <td data-label="Category"><input class="wide" list="categoryList" value="${escapeHtml(m.category || 'Uncategorized')}" onchange="updateMenuItem('${m.id}','category',this.value)"></td>
      <td data-label="Price ₹"><input type="number" min="0" step="0.5" value="${m.price}" onchange="updateMenuItem('${m.id}','price',this.value)"></td>
      <td data-label="GST %"><input type="number" min="0" max="28" value="${m.gst}" onchange="updateMenuItem('${m.id}','gst',this.value)"></td>
      <td data-label="Mode">
        <select onchange="setStockMode('${m.id}', this.value)" title="Manual: you type the count. From recipe: calculated from raw materials.">
          <option value="manual" ${!auto ? 'selected' : ''}>Manual</option>
          <option value="auto"   ${auto  ? 'selected' : ''}>From recipe</option>
        </select>
      </td>
      <td data-label="Stock" class="${(!auto && m.stock <= m.threshold) ? 'low' : ''}">${stockCell}</td>
      <td data-label="Alert at"><input type="number" min="0" value="${m.threshold}" onchange="updateMenuItem('${m.id}','threshold',this.value)"></td>
      <td data-label="Restock">${stockCtrl}</td>
      <td data-label="Recipe"><button onclick="toggleRecipeEditor('${m.id}')">Recipe${recipeCount ? ` (${recipeCount})` : ''}</button></td>
      <td data-label=""><button onclick="confirmAction(this, ()=>deleteMenuItem('${m.id}'))">Delete</button></td>
    </tr>`;

    const editorRow = state.recipeEditItemId === m.id
      ? `<tr class="recipe-row"><td colspan="10">${renderRecipeEditor(m)}</td></tr>`
      : '';

    return mainRow + editorRow;
  }).join('');

  c.innerHTML = `
    <datalist id="categoryList">${catOptions}</datalist>

    <h3>Add a menu item</h3>
    <div class="add-item-form">
      <div><label>Name</label><input id="newName" placeholder="e.g. Masala Tea"></div>
      <div><label>Category</label><input id="newCategory" list="categoryList" placeholder="Veg Snacks, Combos…"></div>
      <div><label>Price ₹ (incl. GST)</label><input id="newPrice" type="number" min="0" step="0.5"></div>
      <div><label>GST %</label><input id="newGst" type="number" min="0" max="28" value="5"></div>
      <div><label>Opening stock (optional)</label><input id="newStock" type="number" min="0" value="0" placeholder="0" title="For ready-made items. Leave 0 for cooked items — add a recipe, and stock will come from raw materials."></div>
      <div><label>Low-stock alert at</label><input id="newThreshold" type="number" min="0" value="5"></div>
      <div><label>Unit (optional)</label><input id="newUnit" placeholder="plate, cup, pc…"></div>
      <div><button class="btn-primary" style="width:100%;margin:0;" onclick="submitNewItem()">Add item</button></div>
    </div>

    ${state.menu.length ? `
    <div class="table-scroll">
      <table class="report-table inv-table">
        <thead><tr>
          <th>Name</th><th>Category</th><th>Price</th><th>GST %</th>
          <th>Mode</th><th>Stock</th><th>Alert at</th><th>Restock</th><th>Recipe</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    : `<p class="empty-state" style="display:block;">No items yet — add your first one above.</p>`}

    <h3>Backup &amp; restore</h3>
    <p style="font-size:.82rem;color:var(--ink-soft);margin:-.3rem 0 .7rem;">
      Your data lives in this browser <em>and</em> in Supabase cloud.
      Download a backup now and then — to a USB drive, cloud folder, or email to yourself.
    </p>
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1rem;">
      <button class="btn-primary" style="width:auto;margin:0;" onclick="backupAllData()">⬇ Download backup file</button>
      <button style="border:1px solid var(--border);background:#fff;border-radius:8px;padding:.7rem 1rem;" onclick="document.getElementById('restoreFile').click()">⬆ Restore from backup file</button>
      <input type="file" id="restoreFile" accept="application/json" style="display:none;" onchange="restoreFromBackup(this.files[0])">
      <button style="border:1px solid var(--border);background:#e8f5e9;border-radius:8px;padding:.7rem 1rem;color:#1f3b2c;" onclick="forcePullFromCloud()">☁ Re-sync from cloud</button>
    </div>
    <button class="btn-text" style="width:auto;" onclick="confirmAction(this, resetAllData)">Reset all data (menu, orders, sales, customers, raw materials)</button>
  `;
}
