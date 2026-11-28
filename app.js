
/* RIVIERA – Frontend. Schreibaktionen laufen über Supabase-RPCs. */

const $ = (id) => document.getElementById(id);

const STATUS = ["Anwesend", "Abwesend", "Unentschuldigt", "Abgemeldet"];
const STATUS_COLORS = ["#27ae60", "#e67e22", "#e53935", "#a855f7"];

const PERMISSIONS = [
  ["members.view", "Mitglieder ansehen"],
  ["members.manage", "Mitglieder hinzufügen/bearbeiten"],
  ["members.rank.edit", "Mitgliederränge bearbeiten"],
  ["members.tasks.view", "Aufgaben ansehen"],
  ["members.tasks.edit", "Aufgaben zuweisen/bearbeiten"],
  ["attendance.view", "Anwesenheit ansehen"],
  ["attendance.edit", "Anwesenheit bearbeiten"],

  ["weekly_submission.view", "Wochenabgabe ansehen"],
  ["weekly_submission.edit", "Wochenabgabe erstellen/bearbeiten"],
  ["weekly_submission.status", "Wochenabgabe-Status ändern"],

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

function formatDate(value) {
  if (!value) return "–";
  const date = new Date(value + "T12:00:00");
  return date.toLocaleDateString("de-DE");
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

/* NACH DEM LOGIN */
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
    "weekly-submission": "Wochenabgabe",
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
  if (page === "weekly-submission") return renderWeeklySubmission(content);

  if (page.endsWith("storage")) {
    return renderStorage(content, page.replace("-", "_"));
  }

  if (page === "admin") return renderAdmin(content);
}

function noAccess(content) {
  content.innerHTML =
    '<div class="panel">Du hast für diesen Bereich keine Berechtigung.</div>';
}

/* MITGLIEDER UND AUFGABEN */
async function renderMembers(content) {
  const mayViewMembers =
    can("members.view") ||
    can("members.manage") ||
    can("members.rank.edit") ||
    can("members.tasks.view") ||
    can("members.tasks.edit");

  if (!mayViewMembers) return noAccess(content);

  const { data: members, error } = await db.from("profiles")
    .select("id,username,display_name,rank,role,active")
    .eq("active", true)
    .order("rank", { ascending: false });

  if (error) throw error;

  let tasks = [];

  if (members.length > 0) {
    const { data, error: taskError } = await db.from("member_tasks")
      .select("id,user_id,title,description,created_at")
      .in("user_id", members.map(member => member.id))
      .order("created_at", { ascending: false });

    if (taskError) throw taskError;
    tasks = data || [];
  }

  const tasksByMember = new Map();

  tasks.forEach(task => {
    if (!tasksByMember.has(task.user_id)) {
      tasksByMember.set(task.user_id, []);
    }
    tasksByMember.get(task.user_id).push(task);
  });

  const mayEditRanks = can("members.manage") || can("members.rank.edit");
  const mayEditTasks = can("members.tasks.edit");

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
            ${members.map(member => {
              const memberTasks = tasksByMember.get(member.id) || [];
              const memberName = member.username || member.display_name || "Mitglied";

              return `
                <tr>
                  <td>${esc(memberName)}</td>
                  <td>
                    Rang ${member.rank}
                    ${mayEditRanks
                      ? `<button class="outline-button small edit-rank"
                           data-id="${member.id}"
                           data-name="${esc(memberName)}"
                           data-rank="${member.rank}">Ändern</button>`
                      : ""}
                  </td>
                  <td>
                    ${memberTasks.length
                      ? memberTasks.map(task => `
                          <div class="task-entry">
                            <div>${esc(task.title)}</div>
                            ${task.description
                              ? `<div class="subtle">${esc(task.description)}</div>`
                              : ""}
                            ${mayEditTasks
                              ? `<button class="outline-button small edit-task"
                                   data-id="${task.id}"
                                   data-title="${esc(task.title)}"
                                   data-description="${esc(task.description || "")}">
                                   Bearbeiten
                                 </button>
                                 <button class="outline-button small danger delete-task"
                                   data-id="${task.id}">Entfernen</button>`
                              : ""}
                          </div>
                        `).join("")
                      : '<span class="subtle">Keine Aufgaben</span>'}

                    ${mayEditTasks
                      ? `<div>
                           <button class="gold-button small add-task"
                             data-id="${member.id}"
                             data-name="${esc(memberName)}">
                             Aufgabe zuweisen
                           </button>
                         </div>`
                      : ""}
                  </td>
                  <td>
                    ${can("members.remove") && member.role !== "founder_admin"
                      ? `<button class="outline-button small danger remove-member"
                           data-id="${member.id}">Entfernen</button>`
                      : "–"}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;

  content.querySelectorAll(".edit-rank").forEach(button => {
    button.onclick = async () => {
      const rankText = prompt(
        `Neuen Rang für ${button.dataset.name} eingeben (1–12):`,
        button.dataset.rank
      );

      if (rankText === null) return;

      const rank = Number(rankText);

      if (!Number.isInteger(rank) || rank < 1 || rank > 12) {
        alert("Der Rang muss eine ganze Zahl zwischen 1 und 12 sein.");
        return;
      }

      try {
        await rpc("admin_update_member", {
          target_user: button.dataset.id,
          new_display_name: button.dataset.name,
          new_rank: rank
        });

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

  content.querySelectorAll(".add-task").forEach(button => {
    button.onclick = async () => {
      const title = prompt(`Neue Aufgabe für ${button.dataset.name}:`);

      if (title === null || !title.trim()) return;

      const description = prompt("Beschreibung der Aufgabe (optional):", "");

      if (description === null) return;

      try {
        const { error } = await db.from("member_tasks").insert({
          user_id: button.dataset.id,
          title: title.trim(),
          description: description.trim(),
          created_by: session.user.id
        });

        if (error) throw error;

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

  content.querySelectorAll(".edit-task").forEach(button => {
    button.onclick = async () => {
      const title = prompt("Aufgabe bearbeiten:", button.dataset.title);
      if (title === null || !title.trim()) return;

      const description = prompt(
        "Beschreibung:",
        button.dataset.description
      );

      if (description === null) return;

      try {
        const { error } = await db.from("member_tasks")
          .update({
            title: title.trim(),
            description: description.trim(),
            updated_at: new Date().toISOString()
          })
          .eq("id", button.dataset.id);

        if (error) throw error;

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

  content.querySelectorAll(".delete-task").forEach(button => {
    button.onclick = async () => {
      if (!confirm("Diese Aufgabe wirklich entfernen?")) return;

      try {
        const { error } = await db.from("member_tasks")
          .delete()
          .eq("id", button.dataset.id);

        if (error) throw error;

        await renderMembers(content);
      } catch (error) {
        alert(error.message);
      }
    };
  });

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
    date.setDate(date.getDate() - i);
    return date;
  });

  const start = dateKey(days[27]);
  const end = dateKey(days[0]);

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

/* WOCHENABGABE */
async function renderWeeklySubmission(content) {
  if (!can("weekly_submission.view")) {
    return noAccess(content);
  }

  const mayCreateOrEdit = can("weekly_submission.edit");
  const mayChangeStatus = can("weekly_submission.status");

  const { data: members, error: memberError } = await db.from("profiles")
    .select("id,username,display_name,rank,active")
    .eq("active", true)
    .order("rank", { ascending: false });

  if (memberError) throw memberError;

  const { data: submissions, error: submissionError } =
    await db.from("weekly_submissions")
      .select("id,item_name,quantity,due_date,created_by,created_at")
      .order("created_at", { ascending: false });

  if (submissionError) throw submissionError;

  const submissionIds = (submissions || []).map(item => item.id);
  let assignments = [];

  if (submissionIds.length > 0) {
    const { data, error } = await db.from("weekly_submission_members")
      .select("id,submission_id,user_id,submitted,submitted_at")
      .in("submission_id", submissionIds);

    if (error) throw error;
    assignments = data || [];
  }

  const { data: allProfiles, error: profilesError } = await db.from("profiles")
    .select("id,username,display_name");

  if (profilesError) throw profilesError;

  const profileNames = new Map(
    (allProfiles || []).map(member => [
      member.id,
      member.username || member.display_name || "Mitglied"
    ])
  );

  const assignmentsBySubmission = new Map();

  assignments.forEach(assignment => {
    if (!assignmentsBySubmission.has(assignment.submission_id)) {
      assignmentsBySubmission.set(assignment.submission_id, []);
    }

    assignmentsBySubmission.get(assignment.submission_id).push(assignment);
  });

  content.innerHTML = `
    ${mayCreateOrEdit ? `
      <div class="panel">
        <h2>Neue Wochenabgabe erstellen</h2>
        <p class="subtle">
          Wähle ein Item, die gemeinsame Anzahl, eine Frist und die Mitglieder,
          die diese Abgabe leisten sollen.
        </p>

        <form id="weeklySubmissionForm">
          <div class="grid-two">
            <label class="field">
              Item
              <input
                id="weeklyItemName"
                type="text"
                placeholder="z. B. Metall"
                required
                maxlength="120"
              >
            </label>

            <label class="field">
              Anzahl pro Mitglied
              <input
                id="weeklyQuantity"
                type="number"
                min="1"
                step="1"
                placeholder="z. B. 100"
                required
              >
            </label>
          </div>

          <label class="field">
            Abgabefrist
            <input id="weeklyDueDate" type="date" required>
          </label>

          <div class="field">
            <strong>Mitglieder auswählen</strong>
            <div class="subtle">Die ausgewählte Anzahl gilt für jedes Mitglied einzeln.</div>

            <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0;">
              <button type="button" class="outline-button small" id="weeklySelectAll">
                Alle auswählen
              </button>
              <button type="button" class="outline-button small" id="weeklySelectNone">
                Auswahl aufheben
              </button>
            </div>

            <div class="panel" style="max-height:240px; overflow-y:auto; padding:12px;">
              ${members.map(member => `
                <label class="checkline" style="display:flex; gap:10px; padding:6px 0;">
                  <input
                    type="checkbox"
                    class="weekly-member-check"
                    value="${member.id}"
                  >
                  <span>
                    ${esc(member.username || member.display_name || "Mitglied")}
                    <span class="subtle"> · Rang ${member.rank}</span>
                  </span>
                </label>
              `).join("") || '<div class="subtle">Keine aktiven Mitglieder gefunden.</div>'}
            </div>
          </div>

          <button class="gold-button" type="submit">
            Wochenabgabe erstellen
          </button>
        </form>
      </div>
    ` : ""}

    <div class="panel">
      <h2>Wochenabgaben & Verlauf</h2>
      <p class="subtle">
        Grün bedeutet abgegeben, Rot bedeutet noch nicht abgegeben.
        Die Historie bleibt gespeichert.
      </p>

      <div
        id="weeklyHistory"
        style="max-height:620px; overflow-y:auto; padding-right:6px;"
      >
        ${submissions.length ? submissions.map(submission => {
          const assigned = assignmentsBySubmission.get(submission.id) || [];
          const submittedCount = assigned.filter(item => item.submitted).length;
          const openCount = assigned.length - submittedCount;

          return `
            <div class="panel" style="margin-bottom:14px;">
              <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
                <div>
                  <h3 style="margin-top:0;">${esc(submission.item_name)}</h3>
                  <div class="subtle">
                    ${submission.quantity} Stück pro Mitglied
                    · Frist: ${formatDate(submission.due_date)}
                  </div>
                  <div class="subtle">
                    Erstellt: ${new Date(submission.created_at).toLocaleString("de-DE")}
                  </div>
                </div>

                <div style="text-align:right;">
                  <strong>${submittedCount} / ${assigned.length} abgegeben</strong>
                  <div class="subtle">
                    ${openCount} noch offen
                  </div>
                  ${mayCreateOrEdit ? `
                    <button
                      type="button"
                      class="outline-button small weekly-edit"
                      data-id="${submission.id}"
                      data-item="${esc(submission.item_name)}"
                      data-quantity="${submission.quantity}"
                      data-date="${submission.due_date}">
                      Angaben bearbeiten
                    </button>
                  ` : ""}
                </div>
              </div>

              <div style="margin-top:12px;">
                ${assigned.length ? assigned.map(assignment => {
                  const name = profileNames.get(assignment.user_id) || "Unbekanntes Mitglied";

                  return `
                    <div
                      style="
                        display:flex;
                        align-items:center;
                        justify-content:space-between;
                        gap:10px;
                        flex-wrap:wrap;
                        padding:9px 10px;
                        margin:6px 0;
                        border-radius:8px;
                        background:${assignment.submitted
                          ? "rgba(39,174,96,0.13)"
                          : "rgba(229,57,53,0.13)"};
                        border:1px solid ${assignment.submitted
                          ? "rgba(39,174,96,0.5)"
                          : "rgba(229,57,53,0.5)"};
                      "
                    >
                      <div>
                        <strong>${esc(name)}</strong>
                        <div style="color:${assignment.submitted ? "#27ae60" : "#e53935"}; font-size:0.9em;">
                          ${assignment.submitted ? "Abgegeben" : "Nicht abgegeben"}
                        </div>
                        ${assignment.submitted_at ? `
                          <div class="subtle">
                            Eingetragen: ${new Date(assignment.submitted_at).toLocaleString("de-DE")}
                          </div>
                        ` : ""}
                      </div>

                      ${mayChangeStatus ? `
                        <button
                          type="button"
                          class="${assignment.submitted ? "outline-button" : "gold-button"} small weekly-status"
                          data-id="${assignment.id}"
                          data-submitted="${assignment.submitted}">
                          ${assignment.submitted ? "Zurück auf offen" : "Als abgegeben markieren"}
                        </button>
                      ` : ""}
                    </div>
                  `;
                }).join("") : `
                  <div class="subtle">Für diese Wochenabgabe wurden keine Mitglieder gespeichert.</div>
                `}
              </div>
            </div>
          `;
        }).join("") : `
          <div class="subtle">Es wurden noch keine Wochenabgaben erstellt.</div>
        `}
      </div>
    </div>
  `;

  /* ALLE MITGLIEDER AUSWÄHLEN */
  const selectAllButton = $("weeklySelectAll");
  const selectNoneButton = $("weeklySelectNone");

  if (selectAllButton) {
    selectAllButton.onclick = () => {
      content.querySelectorAll(".weekly-member-check").forEach(check => {
        check.checked = true;
      });
    };
  }

  if (selectNoneButton) {
    selectNoneButton.onclick = () => {
      content.querySelectorAll(".weekly-member-check").forEach(check => {
        check.checked = false;
      });
    };
  }

  /* WOCHENABGABE ERSTELLEN */
  const createForm = $("weeklySubmissionForm");

  if (createForm) {
    createForm.onsubmit = async event => {
      event.preventDefault();

      const itemName = $("weeklyItemName")?.value.trim();
      const quantity = Number($("weeklyQuantity")?.value);
      const dueDate = $("weeklyDueDate")?.value;

      const memberIds = [
        ...content.querySelectorAll(".weekly-member-check:checked")
      ].map(check => check.value);

      if (!itemName) {
        alert("Bitte einen Itemnamen eingeben.");
        return;
      }

      if (!Number.isInteger(quantity) || quantity < 1) {
        alert("Bitte eine gültige Anzahl eingeben.");
        return;
      }

      if (!dueDate) {
        alert("Bitte eine Abgabefrist auswählen.");
        return;
      }

      if (memberIds.length === 0) {
        alert("Bitte mindestens ein Mitglied auswählen.");
        return;
      }

      try {
        const submitButton = createForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        await rpc("create_weekly_submission", {
          p_item_name: itemName,
          p_quantity: quantity,
          p_due_date: dueDate,
          p_member_ids: memberIds
        });

        alert("Die Wochenabgabe wurde erstellt.");
        await renderWeeklySubmission(content);
      } catch (error) {
        alert(error.message || "Die Wochenabgabe konnte nicht erstellt werden.");
        const submitButton = createForm.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = false;
      }
    };
  }

  /* WOCHENABGABE BEARBEITEN */
  content.querySelectorAll(".weekly-edit").forEach(button => {
    button.onclick = async () => {
      const newItem = prompt(
        "Itemname ändern:",
        button.dataset.item
      );

      if (newItem === null || !newItem.trim()) return;

      const newQuantityText = prompt(
        "Anzahl pro Mitglied ändern:",
        button.dataset.quantity
      );

      if (newQuantityText === null) return;

      const newQuantity = Number(newQuantityText);

      if (!Number.isInteger(newQuantity) || newQuantity < 1) {
        alert("Die Anzahl muss eine ganze Zahl ab 1 sein.");
        return;
      }

      const newDate = prompt(
        "Neue Abgabefrist (JJJJ-MM-TT):",
        button.dataset.date
      );

      if (newDate === null) return;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        alert("Bitte das Datum im Format JJJJ-MM-TT eingeben.");
        return;
      }

      try {
        await rpc("update_weekly_submission", {
          p_submission_id: button.dataset.id,
          p_item_name: newItem.trim(),
          p_quantity: newQuantity,
          p_due_date: newDate
        });

        await renderWeeklySubmission(content);
      } catch (error) {
        alert(error.message || "Die Wochenabgabe konnte nicht bearbeitet werden.");
      }
    };
  });

  /* ABGABESTATUS ÄNDERN */
  content.querySelectorAll(".weekly-status").forEach(button => {
    button.onclick = async () => {
      const currentlySubmitted = button.dataset.submitted === "true";
      const nextStatus = !currentlySubmitted;

      try {
        button.disabled = true;

        await rpc("set_weekly_submission_status", {
          p_assignment_id: button.dataset.id,
          p_submitted: nextStatus
        });

        await renderWeeklySubmission(content);
      } catch (error) {
        button.disabled = false;
        alert(error.message || "Der Status konnte nicht geändert werden.");
      }
    };
  });
}

/* LAGER MIT LIVE-ITEM-SUCHE UND LÖSCHPROTOKOLL */
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
            Item suchen
            <input
              id="moveItemSearch"
              type="text"
              placeholder="Itemnamen eingeben ..."
              autocomplete="off"
              required
            >
            <input id="moveSelect" type="hidden">

            <div
              id="moveSuggestions"
              class="panel"
              style="display:none; margin-top:6px; padding:8px; max-height:180px; overflow-y:auto;"
            ></div>

            <div id="selectedItemInfo" class="subtle"></div>
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
                  ${log.action === "in"
                    ? "Eingelagert"
                    : log.action === "out"
                      ? "Ausgelagert"
                      : "Gelöscht"}:
                  ${esc(log.item_name)}
                  ${log.action === "delete" ? "" : ` × ${log.quantity}`}
                </div>

                ${log.action === "delete" ? `
                  <div style="color:#e53935; font-weight:bold;">
                    Item wurde aus dem Lager entfernt
                  </div>
                ` : `
                  <div class="subtle">
                    Bemerkung: ${esc(log.note || "–")}
                  </div>
                `}

                <div class="subtle">
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

  const searchField = $("moveItemSearch");
  const selectedField = $("moveSelect");
  const suggestions = $("moveSuggestions");
  const selectedInfo = $("selectedItemInfo");

  if (searchField && selectedField && suggestions) {
    function showSuggestions() {
      const search = searchField.value.trim().toLowerCase();

      selectedField.value = "";

      if (selectedInfo) {
        selectedInfo.textContent = "";
      }

      const matches = items.filter(item =>
        item.name.toLowerCase().includes(search)
      );

      if (!search || matches.length === 0) {
        suggestions.style.display = "none";
        suggestions.innerHTML = "";
        return;
      }

      suggestions.innerHTML = matches.map(item => `
        <button
          type="button"
          class="outline-button"
          data-id="${item.id}"
          data-name="${esc(item.name)}"
          data-quantity="${item.quantity}"
          style="display:block; width:100%; text-align:left; margin-bottom:5px;"
        >
          ${esc(item.name)}
          <span class="subtle"> – Bestand: ${item.quantity}</span>
        </button>
      `).join("");

      suggestions.style.display = "block";

      suggestions.querySelectorAll("button").forEach(button => {
        button.onclick = () => {
          selectedField.value = button.dataset.id;
          searchField.value = button.dataset.name;
          suggestions.style.display = "none";

          if (selectedInfo) {
            selectedInfo.textContent =
              "Ausgewählt: " + button.dataset.name +
              " · Bestand: " + button.dataset.quantity;
          }
        };
      });
    }

    searchField.oninput = showSuggestions;
    searchField.onfocus = showSuggestions;
  }

  const moveItemForm = $("moveItem");

  if (moveItemForm) {
    moveItemForm.onsubmit = async event => {
      event.preventDefault();

      const itemId = $("moveSelect");
      const quantity = $("moveQty");
      const action = $("moveAction");
      const note = $("moveNote");

      if (!itemId || !itemId.value) {
        alert("Bitte zuerst ein vorhandenes Item aus den Vorschlägen auswählen.");
        return;
      }

      if (!quantity || !action || !note) {
        alert("Ein Lager-Eingabefeld fehlt.");
        return;
      }

      const amount = Number(quantity.value);

      if (!Number.isInteger(amount) || amount < 1) {
        alert("Bitte eine gültige Anzahl eingeben.");
        return;
      }

      try {
        await rpc("move_inventory_item", {
          item_id: itemId.value,
          move_action: action.value,
          move_quantity: amount,
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
