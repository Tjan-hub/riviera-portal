
/* LAGER */
async function renderStorage(content, key) {
  const prefix = key;
  const viewPermission = prefix + ".view";
  const itemsPermission = prefix + ".items";
  const movePermission = prefix + ".move";
  const removePermission = prefix + ".items.remove";

  if (
    !can(viewPermission) &&
    !can(itemsPermission) &&
    !can(movePermission) &&
    !can(removePermission)
  ) {
    return noAccess(content);
  }

  const { data: items, error } = await db.from("inventory_items")
    .select("id,name,quantity")
    .eq("storage", prefix)
    .eq("active", true)
    .order("name");

  if (error) throw error;

  const { data: logs, error: logError } = await db.from("inventory_logs")
    .select("id,action,item_name,quantity,note,created_at,actor_name")
    .eq("storage", prefix)
    .order("created_at", { ascending: false })
    .limit(200);

  if (logError) throw logError;

  content.innerHTML = `
    <div class="panel">
      <h2>Bestand & Buchungen</h2>

      ${can(itemsPermission) ? `
        <form id="newItem" class="inline-form">
          <input id="itemName" placeholder="Neues Item anlegen" required>
          <button class="gold-button small">Item hinzufügen</button>
        </form>
      ` : ""}

      ${can(movePermission) ? `
        <form id="moveItem" class="toolbar">
          <label class="field">
            Item
            <select id="moveSelect" required>
              ${items.map(item => `
                <option value="${item.id}">
                  ${esc(item.name)} (Bestand: ${item.quantity})
                </option>
              `).join("")}
            </select>
          </label>

          <label class="field">
            Anzahl
            <input id="moveQty" type="number" min="1" step="1" required>
          </label>

          <label class="field">
            Aktion
            <select id="moveAction">
              <option value="in">Einlagern</option>
              <option value="out">Auslagern</option>
            </select>
          </label>

          <label class="field">
            Bemerkung
            <input id="moveNote" placeholder="Bemerkung">
          </label>

          <button class="gold-button">Buchen</button>
        </form>
      ` : ""}

      <div class="grid-two">
        <div>
          <h3>Gesamtbestand</h3>
          <div class="table-wrap scroll-box">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Anzahl</th>
                  ${can(removePermission) ? "<th>Aktion</th>" : ""}
                </tr>
              </thead>
              <tbody>
                ${items.map(item => `
                  <tr>
                    <td>${esc(item.name)}</td>
                    <td>${item.quantity}</td>
                    ${can(removePermission) ? `
                      <td>
                        <button
                          class="outline-button small danger remove-storage-item"
                          data-id="${item.id}"
                          data-name="${esc(item.name)}">
                          Entfernen
                        </button>
                      </td>
                    ` : ""}
                  </tr>
                `).join("") || `
                  <tr>
                    <td colspan="${can(removePermission) ? 3 : 2}">
                      Noch keine Items vorhanden.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3>Lagerprotokolle</h3>
          <div class="panel scroll-box">
            ${logs.map(log => `
              <div class="log-entry">
                <strong>${esc(log.actor_name || "Mitglied")}</strong>
                <div>
                  ${log.action === "in" ? "Eingelagert" : "Ausgelagert"}:
                  ${esc(log.item_name)} × ${log.quantity}
                </div>
                <div class="subtle">
                  Bemerkung: ${esc(log.note || "–")} ·
                  ${new Date(log.created_at).toLocaleString("de-DE")}
                </div>
              </div>
              <hr>
            `).join("") || `
              <div class="subtle">Noch keine Protokolle.</div>
            `}
          </div>
        </div>
      </div>
    </div>`;

  /* Item hinzufügen */
  const newItemForm = $("newItem");

  if (newItemForm) {
    newItemForm.onsubmit = async event => {
      event.preventDefault();

      const itemNameField = $("itemName");
      if (!itemNameField) return;

      try {
        await rpc("add_inventory_item", {
          storage_name: prefix,
          item_name: itemNameField.value.trim()
        });

        await renderStorage(content, key);
      } catch (error) {
        alert(error.message);
      }
    };
  }

  /* Bestand buchen */
  const moveItemForm = $("moveItem");

  if (moveItemForm) {
    moveItemForm.onsubmit = async event => {
      event.preventDefault();

      const select = $("moveSelect");
      const quantity = $("moveQty");
      const action = $("moveAction");
      const note = $("moveNote");

      if (!select || !quantity || !action || !note) {
        alert("Ein Lager-Eingabefeld fehlt.");
        return;
      }

      try {
        await rpc("move_inventory_item", {
          item_id: select.value,
          move_action: action.value,
          move_quantity: Number(quantity.value),
          move_note: note.value
        });

        await renderStorage(content, key);
      } catch (error) {
        alert(error.message);
      }
    };
  }

  /* Item sicher entfernen – wird nur deaktiviert */
  content.querySelectorAll(".remove-storage-item").forEach(button => {
    button.onclick = async () => {
      const itemName = button.dataset.name || "dieses Item";

      if (!confirm(
        `"${itemName}" wirklich aus dem Lager entfernen?\n\n` +
        "Der Artikel wird deaktiviert. Die bisherigen Lagerprotokolle bleiben erhalten."
      )) {
        return;
      }

      try {
        button.disabled = true;

        await rpc("remove_inventory_item", {
          target_item: button.dataset.id
        });

        await renderStorage(content, key);
      } catch (error) {
        button.disabled = false;
        alert(error.message);
      }
    };
  });
}
