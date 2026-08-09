// ── Raw Materials tab ─────────────────────────────────────────────────────
function renderRawTab() {
  const c = document.getElementById('rawContent');

  const rows = state.raw.map(r => `
    <tr>
      <td><input class="wide" value="${escapeHtml(r.name)}" onchange="updateRawMaterial('${r.id}','name',this.value)"></td>
      <td>
        <select onchange="updateRawMaterial('${r.id}','unit',this.value)">
          ${['g','kg','ml','l','pc'].map(u => `<option value="${u}" ${r.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
        </select>
      </td>
      <td class="num ${r.stock <= r.threshold ? 'low' : ''}">${r.stock} ${escapeHtml(r.unit)}</td>
      <td><input type="number" min="0" step="any" value="${r.threshold}" onchange="updateRawMaterial('${r.id}','threshold',this.value)"></td>
      <td style="display:flex;gap:.3rem;align-items:center;flex-wrap:wrap;">
        <input type="number" min="0" step="any" placeholder="Qty" id="rawadj-${r.id}" style="width:70px;">
        <button onclick="adjustRawStock('${r.id}', +document.getElementById('rawadj-${r.id}').value)">+ Add</button>
        <button onclick="adjustRawStock('${r.id}', -(+document.getElementById('rawadj-${r.id}').value))">− Use</button>
      </td>
      <td><button onclick="confirmAction(this, ()=>deleteRawMaterial('${r.id}'))">Delete</button></td>
    </tr>`).join('');

  const recipeItems = state.menu.filter(m => itemRecipe(m).length > 0);
  const portionRows = recipeItems.map(m => {
    const portions  = portionsPossible(m);
    const limiting  = itemRecipe(m)
      .map(l => { const raw = rawById(l.rawId); return raw ? { name: raw.name, can: Math.floor(Math.max(0, raw.stock) / l.qty) } : null; })
      .filter(Boolean)
      .sort((a, b) => a.can - b.can)[0];
    return `<tr>
      <td>${escapeHtml(m.name)}</td>
      <td class="num ${portions !== null && portions <= 5 ? 'low' : ''}">${portions === null ? '—' : portions}</td>
      <td>${limiting ? `${escapeHtml(limiting.name)} (enough for ${limiting.can})` : '—'}</td>
    </tr>`;
  }).join('');

  c.innerHTML = `
    <div class="setting-row">
      <input type="checkbox" id="autoDeductChk" ${state.settings.autoDeductRaw ? 'checked' : ''} onchange="toggleAutoDeduct(this.checked)">
      <label for="autoDeductChk"><strong>Auto-deduct raw materials on orders</strong> — when ON, punching an order uses up ingredients per the item's recipe. When OFF, adjust stock manually. Note: items set to "From recipe" always consume raw materials.</label>
    </div>

    <h3>Add a raw material</h3>
    <div class="add-item-form">
      <div><label>Name</label><input id="rawName" placeholder="e.g. Potato"></div>
      <div>
        <label>Unit</label>
        <select id="rawUnit">
          <option value="g">g (grams)</option>
          <option value="kg">kg</option>
          <option value="ml">ml</option>
          <option value="l">l (litres)</option>
          <option value="pc">pc (pieces)</option>
        </select>
      </div>
      <div><label>Opening stock</label><input id="rawStock" type="number" min="0" step="any" value="0"></div>
      <div><label>Low-stock alert at</label><input id="rawThreshold" type="number" min="0" step="any" value="0"></div>
      <div><button class="btn-primary" style="width:100%;margin:0;" onclick="addRawMaterial()">Add material</button></div>
    </div>

    ${state.raw.length ? `
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Material</th><th>Unit</th><th>In stock</th><th>Alert at</th><th>Adjust stock</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    : `<p class="empty-state" style="display:block;">No raw materials yet. Add potato, flour, oil, milk… then attach them to menu items via the Recipe button in Inventory &amp; Menu.</p>`}

    <h3>Portions possible from current raw stock</h3>
    ${recipeItems.length ? `
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Menu item</th><th class="num">Portions possible</th><th>Limiting ingredient</th></tr></thead>
        <tbody>${portionRows}</tbody>
      </table>
    </div>`
    : `<p class="empty-state" style="display:block;">No recipes yet. Go to Inventory &amp; Menu → click "Recipe" on an item → add ingredients per portion.</p>`}
  `;
}
