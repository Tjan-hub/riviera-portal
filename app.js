
/* RIVIERA – Frontend. Alle Schreibaktionen laufen über Supabase-RPCs mit serverseitiger Rechteprüfung. */
const $ = (id) => document.getElementById(id);
const STATUS = ["Anwesend","Abwesend","Unentschuldigt","Abgemeldet"];
const STATUS_COLORS = ["#27ae60","#e67e22","#e53935","#a855f7"];
const PERMISSIONS = [
  ["members.view","Mitglieder ansehen"],["members.manage","Mitglieder hinzufügen/bearbeiten"],
  ["attendance.view","Anwesenheit ansehen"],["attendance.edit","Anwesenheit bearbeiten"],
  ["main_storage.view","Hauptlager ansehen"],["main_storage.items","Hauptlager: Items hinzufügen"],
  ["main_storage.move","Hauptlager: Ein-/Auslagern"],
  ["leader_storage.view","Leaderlager ansehen"],["leader_storage.items","Leaderlager: Items hinzufügen"],["leader_storage.move","Leaderlager: Ein-/Auslagern"],
  ["weapon_storage.view","Waffenlager ansehen"],["weapon_storage.items","Waffenlager: Items hinzufügen"],["weapon_storage.move","Waffenlager: Ein-/Auslagern"],
  ["members.remove","Mitglieder entfernen"],["permissions.grant","Anderen Rechte vergeben"],["registration.manage","Registrierung öffnen/sperren"]
];
let db, session, profile, page="members", authMode="login", registrationOpen=true;

function usernameToInternalEmail(username) {
  const normalized = username
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

function msg(text, target="globalMessage"){ $(target).textContent=text||""; }
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function dateKey(d){return d.toISOString().slice(0,10);}
function can(p){return !!profile && (profile.role==="founder_admin"||profile.role==="admin"||profile.permissions?.includes(p));}
async function rpc(name,args={}){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
async function loadProfile(){const {data,error}=await db.from("profiles").select("id,email,display_name,rank,role,active").eq("id",session.user.id).single();if(error)throw error;profile=data;const {data:perms}=await db.from("member_permissions").select("permission").eq("user_id",profile.id);profile.permissions=(perms||[]).map(x=>x.permission);}
async function init(){
  if(!window.RIVIERA_CONFIG||window.RIVIERA_CONFIG.SUPABASE_URL.includes("DEIN-PROJEKT")){msg("Bitte zuerst config.js mit deinen Supabase-Projektdaten anlegen.","authMessage");return;}
  db=window.supabase.createClient(window.RIVIERA_CONFIG.SUPABASE_URL,window.RIVIERA_CONFIG.SUPABASE_ANON_KEY);
  const {data}=await db.auth.getSession();session=data.session;
  document.querySelectorAll("[data-auth-tab]").forEach(b=>b.onclick=()=>setAuthMode(b.dataset.authTab));
  $("authForm").onsubmit=authSubmit;$("logout").onclick=()=>db.auth.signOut();
  document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  db.auth.onAuthStateChange((_e,s)=>{session=s;setTimeout(boot,0);});
  await boot();
}
function setAuthMode(mode){authMode=mode;document.querySelectorAll("[data-auth-tab]").forEach(b=>b.classList.toggle("active",b.dataset.authTab===mode));$("authSubmit").textContent=mode==="login"?"Anmelden":"Registrieren";$("password").autocomplete=mode==="login"?"current-password":"new-password";msg("");}

async function authSubmit(e) {
  e.preventDefault();
  msg("Bitte warten…", "authMessage");

  try {
    const username = $("email").value.trim();
    const password = $("password").value;
    const internalEmail = usernameToInternalEmail(username);

    if (authMode === "signup") {
      const { data, error } = await db.auth.signUp({
        email: internalEmail,
        password,
        options: {
          data: {
            username: username,
            display_name: username
          }
        }
      });

      if (error) throw error;

      msg(
        data.session
          ? "Registrierung erfolgreich."
          : "Registrierung angelegt. Bitte prüfe die Supabase-Einstellungen.",
        "authMessage"
      );
    } else {
      const { error } = await db.auth.signInWithPassword({
        email: internalEmail,
        password
      });

      if (error) throw error;
      msg("");
    }
  } catch (err) {
    msg(err.message, "authMessage");
  }
}
);}}
async function boot(){if(!db)return;if(!session){$("authView").classList.remove("hidden");$("appView").classList.add("hidden");return;}
  try{await loadProfile();if(!profile.active)throw new Error("Dieses Konto ist deaktiviert.");$("authView").classList.add("hidden");$("appView").classList.remove("hidden");$("currentUser").textContent=profile.display_name||profile.email;$("rolePill").textContent=profile.role==="founder_admin"?"Gründer-Admin":profile.role==="admin"?"Admin":`Rang ${profile.rank}`;$("adminNav").classList.toggle("hidden",!(profile.role==="founder_admin"||profile.role==="admin"||can("permissions.grant")));await loadRegistrationState();showPage(page);}
  catch(err){msg(err.message);await db.auth.signOut();}}
async function loadRegistrationState(){try{registrationOpen=await rpc("get_registration_open");}catch(_){registrationOpen=true;}}
function showPage(p){page=p;document.querySelectorAll("[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===p));const titles={members:"Mitglieder",attendance:"Anwesenheitsliste","main-storage":"Hauptlager","leader-storage":"Leaderlager","weapon-storage":"Waffenlager",admin:"Admin & Rechte"};$("pageTitle").textContent=titles[p]||"RIVIERA";renderPage().catch(e=>msg(e.message));}
async function renderPage(){const c=$("pageContent");c.innerHTML="";msg("");
 if(page==="members")return renderMembers(c);
 if(page==="attendance")return renderAttendance(c);
 if(page.endsWith("storage"))return renderStorage(c,page.replace("-","_"));
 if(page==="admin")return renderAdmin(c);
}
function noAccess(c){c.innerHTML='<div class="panel">Du hast für diesen Bereich keine Berechtigung.</div>';}
async function renderMembers(c){if(!can("members.view")&&!can("members.manage"))return noAccess(c);
 const {data,error}=await db.from("profiles").select("id,email,display_name,rank,role,active").eq("active",true).order("rank",{ascending:false});if(error)throw error;
 c.innerHTML=`<div class="panel"><div class="toolbar"><div><h2>Mitgliederübersicht</h2><div class="subtle">Rang 1 bis 12 · Rang 12 ist der höchste Rang</div></div>${can("members.manage")?'<button id="addMember" class="gold-button small">Mitglied hinzufügen / einladen</button>':''}</div><div class="table-wrap"><table><thead><tr><th>Name / E-Mail</th><th>Rang</th><th>Kontotyp</th><th>Aktion</th></tr></thead><tbody>${data.map(m=>`<tr><td>${esc(m.display_name||m.email)}<div class="subtle">${esc(m.email)}</div></td><td>Rang ${m.rank}</td><td>${esc(m.role)}</td><td>${can("members.manage")?`<button class="outline-button small edit-member" data-id="${m.id}" data-name="${esc(m.display_name||"")}" data-rank="${m.rank}">Bearbeiten</button>${can("members.remove") && m.role!=="founder_admin"?` <button class="outline-button small danger remove-member" data-id="${m.id}">Entfernen</button>`:""}`:"–"}</td></tr>`).join("")}</tbody></table></div></div>`;
 if($("addMember"))$("addMember").onclick=()=>alert("Neue Mitglieder registrieren sich über die Registrierungsseite. Einladungen können später ergänzt werden.");
 c.querySelectorAll(".remove-member").forEach(b=>b.onclick=async()=>{if(!confirm("Dieses Mitglied wirklich entfernen?"))return;try{await rpc("remove_member",{target_user:b.dataset.id});await renderMembers(c);}catch(e){alert(e.message);}});
 c.querySelectorAll(".edit-member").forEach(b=>b.onclick=async()=>{const name=prompt("Anzeigename",b.dataset.name);if(name===null)return;const rank=Number(prompt("Rang 1–12",b.dataset.rank));if(!Number.isInteger(rank)||rank<1||rank>12)return alert("Ungültiger Rang.");try{await rpc("admin_update_member",{target_user:b.dataset.id,new_display_name:name,new_rank:rank});await renderMembers(c);}catch(e){alert(e.message);}});
}
async function renderAttendance(c){if(!can("attendance.view")&&!can("attendance.edit"))return noAccess(c);
 const {data:members,error}=await db.from("profiles").select("id,display_name,email,rank").eq("active",true).order("rank",{ascending:false});if(error)throw error;
 const days=Array.from({length:28},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-27+i);return d;});
 const start=dateKey(days[0]),end=dateKey(days[27]);
 const {data:records, error:re}=await db.from("attendance").select("user_id,day,status").gte("day",start).lte("day",end);if(re)throw re;
 const lookup=new Map((records||[]).map(r=>[r.user_id+"|"+r.day,r.status]));
 c.innerHTML=`<div class="panel"><h2>Letzte 28 Tage</h2><div class="subtle">Jeder Status wird dauerhaft gespeichert; nur die sichtbare 28-Tage-Ansicht rolliert weiter.</div><div class="attendance-grid"><table><thead><tr><th>Mitglied</th>${days.map(d=>`<th>${d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})}</th>`).join("")}</tr></thead><tbody>${members.map(m=>`<tr><td>${esc(m.display_name||m.email)}</td>${days.map(d=>{const s=lookup.get(m.id+"|"+dateKey(d));return `<td>${can("attendance.edit")?`<button class="attendance-cell" data-user="${m.id}" data-day="${dateKey(d)}" data-status="${s??-1}" style="background:${s==null?"#393939":STATUS_COLORS[s]}">${s==null?"·":STATUS[s].slice(0,1)}</button>`:`<span class="status status-${s??0}">${s==null?"–":STATUS[s]}</span>`}</td>`}).join("")}</tr>`).join("")}</tbody></table></div></div><div class="panel"><h2>Gesamtstatistik</h2><div class="table-wrap"><table><thead><tr><th>Mitglied</th>${STATUS.map(s=>`<th>${s}</th>`).join("")}</tr></thead><tbody>${members.map(m=>`<tr data-stat="${m.id}"><td>${esc(m.display_name||m.email)}</td><td colspan="4">Wird geladen …</td></tr>`).join("")}</tbody></table></div></div>`;
 c.querySelectorAll(".attendance-cell").forEach(b=>b.onclick=async()=>{let next=(Number(b.dataset.status)+1)%4;try{await rpc("set_attendance",{target_user:b.dataset.user,attendance_day:b.dataset.day,new_status:next});await renderAttendance(c);}catch(e){alert(e.message);}});
 const {data:stats,error:se}=await db.from("attendance_stats").select("*");if(!se){members.forEach(m=>{const s=stats.find(x=>x.user_id===m.id);const tr=c.querySelector(`[data-stat="${m.id}"]`);if(s)tr.innerHTML=`<td>${esc(m.display_name||m.email)}</td>${[s.present_count,s.absent_count,s.unexcused_count,s.excused_count].map(n=>`<td>${n}</td>`).join("")}`;else tr.innerHTML=`<td>${esc(m.display_name||m.email)}</td>${[0,0,0,0].map(n=>`<td>${n}</td>`).join("")}`;});}
}
async function renderStorage(c,key){const prefix=key;const view=prefix+".view",itemsPerm=prefix+".items",movePerm=prefix+".move";if(!can(view)&&!can(itemsPerm)&&!can(movePerm))return noAccess(c);
 const {data:items,error}=await db.from("inventory_items").select("id,name,quantity").eq("storage",prefix).eq("active",true).order("name");if(error)throw error;
 const {data:logs,error:le}=await db.from("inventory_logs").select("id,action,item_name,quantity,note,created_at,actor_name").eq("storage",prefix).order("created_at",{ascending:false}).limit(200);if(le)throw le;
 c.innerHTML=`<div class="panel"><h2>Bestand & Buchungen</h2>${can(itemsPerm)?`<form id="newItem" class="inline-form"><input id="itemName" placeholder="Neues Item anlegen" required><button class="gold-button small">Item hinzufügen</button></form>`:""}${can(movePerm)?`<form id="moveItem" class="toolbar"><label class="field">Item<select id="moveSelect" required>${items.map(i=>`<option value="${i.id}">${esc(i.name)} (Bestand: ${i.quantity})</option>`).join("")}</select></label><label class="field">Anzahl<input id="moveQty" type="number" min="1" step="1" required></label><label class="field">Aktion<select id="moveAction"><option value="in">Einlagern</option><option value="out">Auslagern</option></select></label><label class="field">Bemerkung<input id="moveNote" placeholder="Bemerkung"></label><button class="gold-button">Buchen</button></form>`:""}<div class="grid-two"><div><h3>Gesamtbestand</h3><div class="table-wrap scroll-box"><table><thead><tr><th>Item</th><th>Anzahl</th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.name)}</td><td>${i.quantity}</td></tr>`).join("")||'<tr><td colspan="2">Noch keine Items vorhanden.</td></tr>'}</tbody></table></div></div><div><h3>Lagerprotokolle</h3><div class="panel scroll-box">${logs.map(l=>`<div class="log-entry"><strong>${esc(l.actor_name||"Mitglied")}</strong><div>${l.action==="in"?"Eingelagert":"Ausgelagert"}: ${esc(l.item_name)} × ${l.quantity}</div><div class="subtle">Bemerkung: ${esc(l.note||"–")} · ${new Date(l.created_at).toLocaleString("de-DE")}</div></div><hr>`).join("")||'<div class="subtle">Noch keine Protokolle.</div>'}</div></div></div></div>`;
 if($("newItem"))$("newItem").onsubmit=async e=>{e.preventDefault();try{await rpc("add_inventory_item",{storage_name:prefix,item_name:$("itemName").value.trim()});await renderStorage(c,key);}catch(err){alert(err.message);}};
 if($("moveItem"))$("moveItem").onsubmit=async e=>{e.preventDefault();try{await rpc("move_inventory_item",{item_id:$("moveSelect").value,move_action:$("moveAction").value,move_quantity:Number($("moveQty").value),move_note:$("moveNote").value});await renderStorage(c,key);}catch(err){alert(err.message);}};
}
async function renderAdmin(c){if(!(profile.role==="founder_admin"||profile.role==="admin"||can("permissions.grant")))return noAccess(c);
 const {data:members,error}=await db.from("profiles").select("id,email,display_name,rank,role,active").eq("active",true).order("email");if(error)throw error;
 const mayGrant=profile.role==="founder_admin"||profile.role==="admin"||can("permissions.grant");
 c.innerHTML=`<div class="panel"><h2>Mitgliederrechte</h2><label class="field">Mitglied auswählen<select id="permMember">${members.map(m=>`<option value="${m.id}">${esc(m.display_name||m.email)} – ${esc(m.role)}</option>`).join("")}</select></label><div id="permissionChecks" class="permission-list"></div><button id="savePermissions" class="gold-button" ${mayGrant?"":"disabled"}>Berechtigungen speichern</button></div><div class="panel"><h2>Registrierung</h2><p class="subtle">Aktueller Status: ${registrationOpen?"offen":"gesperrt"}</p>${can("registration.manage")?`<button id="toggleRegistration" class="gold-button">${registrationOpen?"Registrierung sperren":"Registrierung öffnen"}</button>`:"Keine Berechtigung zum Ändern."}</div><div class="panel"><h2>Admin-Regeln</h2><p class="subtle">Der Gründer-Admin ist geschützt. Der zweite Admin kann vom Gründer entfernt werden. Maximal zwei Admin-Konten.</p>${profile.role==="founder_admin"?`<label class="field">Zweiten Admin ernennen<select id="secondAdmin">${members.filter(m=>m.id!==profile.id).map(m=>`<option value="${m.id}">${esc(m.display_name||m.email)}</option>`).join("")}</select></label><button id="appointAdmin" class="gold-button">Als zweiten Admin ernennen</button>`:""}</div>`;
 const select=$("permMember");async function loadChecks(){const target=select.value;const {data}=await db.from("member_permissions").select("permission").eq("user_id",target);const current=new Set((data||[]).map(x=>x.permission));$("permissionChecks").innerHTML=PERMISSIONS.map(([k,label])=>`<label class="checkline"><input type="checkbox" value="${k}" ${current.has(k)?"checked":""}>${label}</label>`).join("");}
 select.onchange=loadChecks;await loadChecks();
 if(mayGrant)$("savePermissions").onclick=async()=>{const permissions=[...$("permissionChecks").querySelectorAll("input:checked")].map(x=>x.value);try{await rpc("set_member_permissions",{target_user:select.value,new_permissions:permissions});msg("Berechtigungen gespeichert.");}catch(e){alert(e.message);}};
 if($("toggleRegistration"))$("toggleRegistration").onclick=async()=>{try{registrationOpen=await rpc("set_registration_open",{new_open:!registrationOpen});await renderAdmin(c);}catch(e){alert(e.message);}};
 if($("appointAdmin"))$("appointAdmin").onclick=async()=>{try{await rpc("appoint_second_admin",{target_user:$("secondAdmin").value});alert("Zweiter Admin ernannt.");await boot();}catch(e){alert(e.message);}};
}
init();
