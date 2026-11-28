
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

  /* RANG ÄNDERN */
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

  /* AUFGABE ZUWEISEN */
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

  /* AUFGABE BEARBEITEN */
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

  /* AUFGABE ENTFERNEN */
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

  /* MITGLIED ENTFERNEN */
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
