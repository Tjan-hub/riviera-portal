
/* RIVIERA – Frontend. Schreibaktionen laufen über Supabase-RPCs. */

const $ = (id) => document.getElementById(id);

const STATUS = ["Anwesend", "Abwesend", "Unentschuldigt", "Abgemeldet"];
const STATUS_COLORS = ["#27ae60", "#e67e22", "#e53935", "#a855f7"];

const PERMISSIONS = [
  ["members.view", "Mitglieder ansehen"],
  ["members.manage", "Mitglieder hinzufügen/bearbeiten"],
  ["attendance.view", "Anwesenheit ansehen"],
  ["attendance.edit", "Anwesenheit bearbeiten"],
  ["main_storage.view", "Hauptlager ansehen"],
  ["main_storage.items", "Hauptlager: Items hinzufügen"],
  ["main_storage.move", "Hauptlager: Ein-/Auslagern"],
  ["main_storage.items.remove", "Hauptlager: Items entfernen"],
  ["leader_storage.view", "Leaderlager ansehen"],
  ["leader_storage.items", "Leaderlager: Items hinzufügen"],
  ["leader_storage.move", "Leaderlager: Ein-/Auslagern"],
  ["leader_storage.items.remove", "Leaderlager: Items entfernen"],
  ["weapon_storage.view", "Waffenlager ansehen"],
  ["weapon_storage.items", "Waffenlager: Items hinzufügen"],
  ["weapon_storage.move", "Waffenlager: Ein-/Auslagern"],
  ["weapon_storage.items.remove", "Waffenlager: Items entfernen"],
  ["members.remove", "Mitglieder entfernen"],
  ["permissions.grant", "Anderen Rechte vergeben"],
  ["registration.manage", "Registrierung öffnen/sperren"]
];

let db;
let session;
let profile;
let page = "members";
let authMode = "login";
let registrationOpen = true;
let bootInProgress = false;

function usernameToInternalEmail(username) {
  const normalized = String(username || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");

  if (normalized.length < 3) {
    throw new Error("Der Benutzername muss mindestens 3 gültige Zeichen enthalten.");
  }

  return normalized + "@riviera.invalid";
}

function msg(text, target = "globalMessage") {
  const element = $(target);
  if (element) element.textContent = text || "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function dateKey(d) {
  return d.toISOString().slice(0, 10);
}

function can(p) {
  return !!profile &&
    (
      profile.role === "founder_admin" ||
      profile.role === "admin" ||
      profile.permissions?.includes(p)
    );
}

async function rpc(name, args = {}) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

/* PROFIL LADEN */
async function loadProfile() {
  const { data, error } = await db.from("profiles")
    .select("id,email,username,display_name,rank,role,active")
    .eq("id", session.user.id)
    .single();

  if (error) throw error;

  profile = data;

  const { data: perms, error: permissionError } =
    await db.from("member_permissions")
      .select("permission")
      .eq("user_id", profile.id);

  if (permissionError) throw permissionError;

  profile.permissions = (perms || []).map(x => x.permission);
}

/* START */
async function init() {
  const config = window.RIVIERA_CONFIG;

  if (
    !config ||
    !config.SUPABASE_URL ||
    !config.SUPABASE_ANON_KEY ||
    config.SUPABASE_URL.includes("DEIN-PROJEKT")
  ) {
    msg("Bitte zuerst config.js mit deinen Supabase-Projektdaten einrichten.", "authMessage");
    return;
  }

  if (!window.supabase) {
    msg("Supabase konnte nicht geladen werden.", "authMessage");
    return;
  }

  db = window.supabase.createClient(
    config.SUPABASE_URL,
    config.SUPABASE_ANON_KEY
  );

  const { data, error } = await db.auth.getSession();

  if (error) {
    msg(error.message, "authMessage");
    return;
  }

  session = data.session;

  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.onclick = () => setAuthMode(button.dataset.authTab);
  });

  const authForm = $("authForm");
  const logoutButton = $("logout");

  if (!authForm) {
    msg("Das Anmeldeformular wurde nicht gefunden.", "authMessage");
    return;
  }

  authForm.onsubmit = authSubmit;

  if (logoutButton) {
    logoutButton.onclick = async () => {
      await db.auth.signOut();
    };
  }

  document.querySelectorAll("[data-page]").forEach(button => {
    button.onclick = () => showPage(button.dataset.page);
  });

  db.auth.onAuthStateChange((_event, newSession) => {
    session = newSession;
    setTimeout(() => boot(), 0);
  });

  await boot();
}

/* ANMELDEN / REGISTRIEREN UMSCHALTEN */
function setAuthMode(mode) {
  authMode = mode;

  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.authTab === mode);
  });

  const submitButton = $("authSubmit");
  const passwordField = $("password");

  if (submitButton) {
    submitButton.textContent =
      mode === "login" ? "Anmelden" : "Registrieren";
  }

  if (passwordField) {
    passwordField.autocomplete =
      mode === "login" ? "current-password" : "new-password";
  }

  msg("", "authMessage");
}

/* ANMELDUNG MIT BENUTZERNAME UND PASSWORT */
async function authSubmit(e) {
  e.preventDefault();

  const usernameField = $("username");
  const passwordField = $("password");
  const messageField = $("authMessage");

  if (!usernameField || !passwordField || !messageField) {
    msg("Anmeldefelder fehlen. Bitte prüfe die index.html.", "authMessage");
    return;
  }

  messageField.textContent = "Bitte warten…";

  try {
    const username = usernameField.value.trim();
    const password = passwordField.value;

    if (!username) {
      throw new Error("Bitte deinen Benutzernamen eingeben.");
    }

    if (!password) {
      throw new Error("Bitte dein Passwort eingeben.");
    }

    const internalEmail = usernameToInternalEmail(username);

    if (authMode === "signup") {
      const { data, error } = await db.auth.signUp({
        email: internalEmail,
        password,
        options: {
          data: {
            username,
            display_name: username
          }
        }
      });

      if (error) throw error;

      if (data.session) {
        session = data.session;
        await boot();
      } else {
        messageField.textContent =
          "Registrierung angelegt. Bitte prüfe die Supabase-Einstellungen.";
      }
    } else {
      const { data, error } = await db.auth.signInWithPassword({
        email: internalEmail,
        password
      });

      if (error) throw error;

      if (!data.session) {
        throw new Error("Anmeldung erfolgreich, aber keine Sitzung erhalten.");
      }

      session = data.session;
      messageField.textContent = "";

      await boot();
    }
  } catch (error) {
    messageField.textContent =
      error.message || "Ein Fehler ist aufgetreten.";
  }
}

/* NACH DEM LOGIN – KORRIGIERT */
async function boot() {
  if (!db || bootInProgress) return;

  bootInProgress = true;

  try {
    const { data, error } = await db.auth.getSession();

    if (error) throw error;

    session = data.session;

    if (!session) {
      profile = null;
      $("appView")?.classList.add("hidden");
      $("authView")?.classList.remove("hidden");
      return;
    }

    await loadProfile();

    if (!profile || !profile.active) {
      throw new Error("Dieses Konto ist deaktiviert.");
    }

    $("authView")?.classList.add("hidden");
    $("appView")?.classList.remove("hidden");

    if ($("currentUser")) {
      $("currentUser").textContent =
        profile.username || profile.display_name || "Mitglied";
    }

    if ($("rolePill")) {
      $("rolePill").textContent =
        profile.role === "founder_admin"
          ? "Gründer-Admin"
          : profile.role === "admin"
            ? "Admin"
            : `Rang ${profile.rank}`;
    }

    if ($("adminNav")) {
      $("adminNav").classList.toggle(
        "hidden",
        !(
          profile.role === "founder_admin" ||
          profile.role === "admin" ||
          can("permissions.grant")
        )
      );
    }

    await loadRegistrationState();
    await renderPage();

  } catch (error) {
    console.error("Fehler beim Öffnen der Hauptseite:", error);

    msg(
      error.message || "Die Hauptseite konnte nicht geladen werden.",
      "authMessage"
    );

    $("appView")?.classList.add("hidden");
    $("authView")?.classList.remove("hidden");

  } finally {
    bootInProgress = false;
  }
}

async function loadRegistrationState() {
  try {
    registrationOpen = await rpc("get_registration_open");
  } catch (_error) {
    registrationOpen = true;
  }
}

/* SEITENNAVIGATION */
function showPage(p) {
  page = p;

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === p);
  });

  const titles = {
    members: "Mitglieder",
    attendance: "Anwesenheitsliste",
    "main-storage": "Hauptlager",
    "leader-storage": "Leaderlager",
    "weapon-storage": "Waffenlager",
    admin: "Admin & Rechte"
  };

  if ($("pageTitle")) {
    $("pageTitle").textContent = titles[p] || "RIVIERA";
  }

  renderPage().catch(error => {
    console.error(error);
    msg(error.message);
  });
}

async function renderPage() {
  const content = $("pageContent");

  if (!content) {
    throw new Error("Der Seitenbereich wurde nicht gefunden.");
  }

  content.innerHTML = "";
  msg("");

  if (page === "members") return renderMembers(content);
  if (page === "attendance") return renderAttendance(content);

  if (page.endsWith("storage")) {
    return renderStorage(content, page.replace("-", "_"));
  }

  if (page === "admin") return renderAdmin(content);
}

function noAccess(content) {
  content.innerHTML =
    '<div class="panel">Du hast für diesen Bereich keine Berechtigung.</div>';
}

/* MITGLIEDER */
async function renderMembers(content) {
  if (!can("members.view") && !can("members.manage")) {
    return noAccess(content);
  }

  const { data, error } = await db.from("profiles")
    .select("id,username,display_name,rank,role,active")
    .eq("active", true)
    .order("rank", { ascending: false });

  if (error) throw error;

  content.innerHTML = `
    <div class="panel">
      <div class="toolbar">
        <div>
          <h2>Mitgliederübersicht</h2>
          <div class="subtle">Rang 1 bis 12 · Rang 12 ist der höchste Rang</div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mitglied</th>
              <th>Rang</th>
              <th>Aufgaben</th>
              <th>Aktion</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(member => `
              <tr>
                <td>${esc(member.username || member.display_name || "Mitglied")}</td>
                <td>Rang ${member.rank}</td>
                <td>–</td>
                <td>
                  ${can("members.manage")
                    ? `<button class="outline-button small edit-member"
                         data-id="${member.id}"
                         data-name="${esc(member.username || member.display_name || "")}"
                         data-rank="${member.rank}">Bearbeiten</button>`
                    : "–"}
                  ${can("members.remove") && member.role !== "founder_admin"
                    ? ` <button class="outline-button small danger remove-member"
                         data-id="${member.id}">Entfernen</button>`
                    : ""}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  content.querySelectorAll(".remove-member").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Dieses Mitglied wirklich entfernen?")) return;

      try {
        await rpc("remove_member", {
          target_user: button.dataset.id
        });

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

  content.querySelectorAll(".edit-member").forEach(button => {
    button.onclick = async () => {
      const name = prompt("Benutzername", button.dataset.name);
      if (name === null) return;

      const rank = Number(prompt("Rang 1–12", button.dataset.rank));

      if (!Number.isInteger(rank) || rank < 1 || rank > 12) {
        return alert("Ungültiger Rang.");
      }

      try {
        await rpc("admin_update_member", {
          target_user: button.dataset.id,
          new_display_name: name,
          new_rank: rank
        });

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });
}

/* ANWESENHEIT */
async function renderAttendance(content) {
  if (!can("attendance.view") && !can("attendance.edit")) {
    return noAccess(content);
  }

  const { data: members, error } = await db.from("profiles")
    .select("id,username,display_name,rank")
    .eq("active", true)
    .order("rank", { ascending: false });

  if (error) throw error;

  const days = Array.from({ length: 28 }, (_, i) => {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - 27 + i);
    return date;
  });

  const start = dateKey(days[0]);
  const end = dateKey(days[27]);

  const { data: records, error: recordError } = await db.from("attendance")
    .select("user_id,day,status")
    .gte("day", start)
    .lte("day", end);

  if (recordError) throw recordError;

  const lookup = new Map(
    (records || []).map(record => [
      record.user_id + "|" + record.day,
      record.status
    ])
  );

  content.innerHTML = `
    <div class="panel">
      <h2>Letzte 28 Tage</h2>
      <div class="subtle">
        Jeder Status wird dauerhaft gespeichert; nur die sichtbare
        28-Tage-Ansicht rolliert weiter.
      </div>
      <div class="attendance-grid">
        <table>
          <thead>
            <tr>
              <th>Mitglied</th>
              ${days.map(date => `
                <th>${date.toLocaleDateString("de-DE", {
                  day: "2-digit",
                  month: "2-digit"
                })}</th>
              `).join("")}
            </tr>
          </thead>
          <tbody>
            ${members.map(member => `
              <tr>
                <td>${esc(member.username || member.display_name || "Mitglied")}</td>
                ${days.map(date => {
                  const status = lookup.get(member.id + "|" + dateKey(date));

                  return `<td>${
                    can("attendance.edit")
                      ? `<button class="attendance-cell"
                           data-user="${member.id}"
                           data-day="${dateKey(date)}"
                           data-status="${status ?? -1}"
                           style="background:${status == null ? "#393939" : STATUS_COLORS[status]}">
                           ${status == null ? "·" : STATUS[status].slice(0, 1)}
                         </button>`
                      : `<span class="status status-${status ?? 0}">
                           ${status == null ? "–" : STATUS[status]}
                         </span>`
                  }</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2>Gesamtstatistik</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mitglied</th>
              ${STATUS.map(status => `<th>${status}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${members.map(member => `
              <tr data-stat="${member.id}">
                <td>${esc(member.username || member.display_name || "Mitglied")}</td>
                <td colspan="4">Wird geladen …</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  content.querySelectorAll(".attendance-cell").forEach(button => {
    button.onclick = async () => {
      const next = (Number(button.dataset.status) + 1) % 4;

      try {
        await rpc("set_attendance", {
          target_user: button.dataset.user,
          attendance_day: button.dataset.day,
          new_status: next
        });

        await renderAttendance(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

  const { data: stats, error: statsError } =
    await db.from("attendance_stats").select("*");

  if (!statsError) {
    members.forEach(member => {
      const stat = (stats || []).find(x => x.user_id === member.id);
      const row = content.querySelector(`[data-stat="${member.id}"]`);

      if (!row) return;

      const name = esc(member.username || member.display_name || "Mitglied");

      if (stat) {
        row.innerHTML = `
          <td>${name}</td>
          ${[
            stat.present_count,
            stat.absent_count,
            stat.unexcused_count,
            stat.excused_count
          ].map(number => `<td>${number}</td>`).join("")}
        `;
      } else {
        row.innerHTML = `
          <td>${name}</td>
          ${[0, 0, 0, 0].map(number => `<td>${number}</td>`).join("")}
        `;
      }
    });
  }
}

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

/* ADMIN UND RECHTE */
async function renderAdmin(content) {
  if (
    !(
      profile.role === "founder_admin" ||
      profile.role === "admin" ||
      can("permissions.grant")
    )
  ) {
    return noAccess(content);
  }

  const { data: members, error } = await db.from("profiles")
    .select("id,username,display_name,rank,role,active")
    .eq("active", true)
    .order("username");

  if (error) throw error;

  const mayGrant =
    profile.role === "founder_admin" ||
    profile.role === "admin" ||
    can("permissions.grant");

  content.innerHTML = `
    <div class="panel">
      <h2>Mitgliederrechte</h2>

      <label class="field">
        Mitglied auswählen
        <select id="permMember">
          ${members.map(member => `
            <option value="${member.id}">
              ${esc(member.username || member.display_name || "Mitglied")}
              – ${esc(member.role)}
            </option>
          `).join("")}
        </select>
      </label>

      <div id="permissionChecks" class="permission-list"></div>

      <button id="savePermissions" class="gold-button"
        ${mayGrant ? "" : "disabled"}>
        Berechtigungen speichern
      </button>
    </div>

    <div class="panel">
      <h2>Registrierung</h2>
      <p class="subtle">
        Aktueller Status: ${registrationOpen ? "offen" : "gesperrt"}
      </p>

      ${can("registration.manage")
        ? `<button id="toggleRegistration" class="gold-button">
             ${registrationOpen ? "Registrierung sperren" : "Registrierung öffnen"}
           </button>`
        : "Keine Berechtigung zum Ändern."}
    </div>

    <div class="panel">
      <h2>Admin-Regeln</h2>
      <p class="subtle">
        Der Gründer-Admin ist geschützt. Der zweite Admin kann vom Gründer
        entfernt werden. Maximal zwei Admin-Konten.
      </p>

      ${profile.role === "founder_admin" ? `
        <label class="field">
          Zweiten Admin ernennen
          <select id="secondAdmin">
            ${members.filter(member => member.id !== profile.id).map(member => `
              <option value="${member.id}">
                ${esc(member.username || member.display_name || "Mitglied")}
              </option>
            `).join("")}
          </select>
        </label>

        <button id="appointAdmin" class="gold-button">
          Als zweiten Admin ernennen
        </button>
      ` : ""}
    </div>`;

  const select = $("permMember");

  async function loadChecks() {
    if (!select) return;

    const target = select.value;

    const { data, error } = await db.from("member_permissions")
      .select("permission")
      .eq("user_id", target);

    if (error) throw error;

    const current = new Set((data || []).map(item => item.permission));
    const checks = $("permissionChecks");

    if (!checks) return;

    checks.innerHTML = PERMISSIONS.map(([key, label]) => `
      <label class="checkline">
        <input type="checkbox" value="${key}"
          ${current.has(key) ? "checked" : ""}>
        ${label}
      </label>
    `).join("");
  }

  if (select) {
    select.onchange = loadChecks;
    await loadChecks();
  }

  const saveButton = $("savePermissions");

  if (mayGrant && saveButton) {
    saveButton.onclick = async () => {
      const checks = $("permissionChecks");

      const permissions = checks
        ? [...checks.querySelectorAll("input:checked")].map(input => input.value)
        : [];

      try {
        await rpc("set_member_permissions", {
          target_user: select.value,
          new_permissions: permissions
        });

        msg("Berechtigungen gespeichert.");
      } catch (error) {
        alert(error.message);
      }
    };
  }

  const toggleButton = $("toggleRegistration");

  if (toggleButton) {
    toggleButton.onclick = async () => {
      try {
        registrationOpen = await rpc("set_registration_open", {
          new_open: !registrationOpen
        });

        await renderAdmin(content);
      } catch (error) {
        alert(error.message);
      }
    };
  }

  const appointButton = $("appointAdmin");

  if (appointButton) {
    appointButton.onclick = async () => {
      const secondAdmin = $("secondAdmin");

      if (!secondAdmin) {
        alert("Bitte zuerst ein Mitglied auswählen.");
        return;
      }

      try {
        await rpc("appoint_second_admin", {
          target_user: secondAdmin.value
        });

        alert("Zweiter Admin ernannt.");
        await boot();
      } catch (error) {
        alert(error.message);
      }
    };
  }
}

init();
