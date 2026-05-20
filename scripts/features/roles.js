"use strict";

// ── CRUD ──

function createEmptyRole() {
  return {
    id: "role-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    name: "",
    description: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function addRole(name, description) {
  var role = createEmptyRole();
  role.name = name.trim();
  role.description = description.trim();
  state.userRoles.unshift(role);
  persistUserRoles();
  return role;
}

function updateRole(id, name, description) {
  var role = state.userRoles.find(function (r) { return r.id === id; });
  if (!role) return null;
  role.name = name.trim();
  role.description = description.trim();
  role.updatedAt = new Date().toISOString();
  persistUserRoles();
  return role;
}

function deleteRole(id) {
  state.userRoles = state.userRoles.filter(function (r) { return r.id !== id; });
  persistUserRoles();
}

function getRoleById(id) {
  return state.userRoles.find(function (r) { return r.id === id; }) || null;
}

// ── Render ──

var _rolesInited = false;

function syncRolesViewState(options = {}) {
  var hasRoles = Array.isArray(state.userRoles) && state.userRoles.length > 0;
  var isEditing = !els.roleEditPanel?.classList.contains("hidden");
  var isCreating = (els.roleEditPanel?.dataset.mode || "") === "create";
  var showEmptyHint = !isEditing && (options.showEmptyHint ?? hasRoles);
  if (!hasRoles && isCreating) {
    showEmptyHint = false;
  }

  if (els.roleEditPanel) {
    els.roleEditPanel.classList.toggle("hidden", !isEditing);
  }
  if (els.roleEditEmptyState) {
    els.roleEditEmptyState.classList.toggle("hidden", !showEmptyHint);
  }
}

function initRolesView() {
  if (_rolesInited) return;
  _rolesInited = true;
  bindRolesPage();
  renderRoleList();
}

function bindRolesPage() {
  if (els.addRoleBtn) {
    els.addRoleBtn.addEventListener("click", function () {
      openRoleEditor("");
    });
  }
  if (els.roleSaveBtn) {
    els.roleSaveBtn.addEventListener("click", saveRoleFromEditor);
  }
  if (els.roleCancelBtn) {
    els.roleCancelBtn.addEventListener("click", closeRoleEditor);
  }
}

function renderRoleList() {
  if (!els.roleList) return;
  els.roleList.innerHTML = "";
  var activeRoleId = els.roleEditPanel?.dataset.editRoleId || "";

  if (!state.userRoles.length) {
    els.roleList.innerHTML = "<div class=\"hint-text\">" + escapeHtml(t("roleLibrary.empty")) + "</div>";
    var isCreating = (els.roleEditPanel?.dataset.mode || "") === "create";
    if (els.roleEditPanel && !isCreating) {
      els.roleEditPanel.dataset.editRoleId = "";
      els.roleEditPanel.dataset.mode = "";
      els.roleEditPanel.classList.add("hidden");
    }
    syncRolesViewState({ showEmptyHint: false });
    return;
  }

  state.userRoles.forEach(function (role) {
    var card = document.createElement("div");
    var isActive = activeRoleId === role.id;
    card.className = "role-library-item" + (isActive ? " active" : "");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-pressed", isActive ? "true" : "false");
    card.addEventListener("click", function () {
      openRoleEditor(role.id);
    });
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openRoleEditor(role.id);
      }
    });

    var top = document.createElement("div");
    top.className = "role-library-item-top";

    var nameEl = document.createElement("strong");
    nameEl.className = "role-library-item-name";
    nameEl.textContent = role.name || "(unnamed)";

    var actions = document.createElement("div");
    actions.className = "role-library-item-actions";

    var editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "role-library-item-edit-btn";
    editBtn.setAttribute("data-role-id", role.id);
    editBtn.innerHTML = "<i data-lucide=\"pencil\" class=\"role-edit-icon\"></i>";
    editBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openRoleEditor(role.id);
    });

    var deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "role-library-item-delete-btn";
    deleteBtn.setAttribute("data-role-id", role.id);
    deleteBtn.innerHTML = "<i data-lucide=\"trash-2\" class=\"role-delete-icon\"></i>";
    deleteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      confirmDeleteRole(role.id);
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    top.appendChild(nameEl);
    top.appendChild(actions);

    var desc = document.createElement("p");
    desc.className = "role-library-item-desc";
    desc.textContent = role.description || "";

    card.appendChild(top);
    card.appendChild(desc);
    els.roleList.appendChild(card);
  });

  syncRolesViewState();

  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}

function openRoleEditor(roleId) {
  var role = roleId ? getRoleById(roleId) : null;

  if (!els.roleEditNameInput || !els.roleEditDescInput || !els.roleEditPanel) return;

  if (role) {
    els.roleEditNameInput.value = role.name;
    els.roleEditDescInput.value = role.description;
  } else {
    els.roleEditNameInput.value = "";
    els.roleEditDescInput.value = "";
  }

  els.roleEditPanel.dataset.editRoleId = roleId || "";
  els.roleEditPanel.dataset.mode = role ? "edit" : "create";
  els.roleEditPanel.classList.remove("hidden");
  syncRolesViewState();
  renderRoleList();

  // Focus name input
  setTimeout(function () { els.roleEditNameInput.focus(); }, 50);
}

function closeRoleEditor() {
  if (els.roleEditPanel) {
    els.roleEditPanel.classList.add("hidden");
    els.roleEditPanel.dataset.editRoleId = "";
    els.roleEditPanel.dataset.mode = "";
  }
  syncRolesViewState();
  renderRoleList();
}

function saveRoleFromEditor() {
  if (!els.roleEditNameInput || !els.roleEditDescInput || !els.roleEditPanel) return;

  var name = els.roleEditNameInput.value.trim();
  var description = els.roleEditDescInput.value.trim();
  if (!name) {
    setText(els.chatStatus, t("roleLibrary.roleName") + (state.locale === "en-US" ? " is required" : "不能为空"));
    return;
  }

  var editRoleId = els.roleEditPanel.dataset.editRoleId || "";
  if (editRoleId) {
    updateRole(editRoleId, name, description);
  } else {
    var created = addRole(name, description);
    editRoleId = created?.id || "";
  }

  if (els.roleEditPanel) {
    els.roleEditPanel.dataset.editRoleId = editRoleId || "";
    els.roleEditPanel.dataset.mode = editRoleId ? "edit" : "";
  }
  renderRoleList();
  syncRolesViewState({ showEmptyHint: false });

  // Refresh role select in create view if open
  if (typeof refreshRoleSelectOptions === "function") {
    refreshRoleSelectOptions();
  }
}

function confirmDeleteRole(roleId) {
  var role = state.userRoles.find(function (r) { return r.id === roleId; });
  if (!role) return;
  if (!confirm(t("roleLibrary.confirmDelete", { name: role.name }))) return;
  var isEditingDeletedRole = (els.roleEditPanel?.dataset.editRoleId || "") === roleId;
  deleteRole(roleId);
  if (isEditingDeletedRole && els.roleEditPanel) {
    els.roleEditPanel.classList.add("hidden");
    els.roleEditPanel.dataset.editRoleId = "";
    els.roleEditPanel.dataset.mode = "";
  }
  renderRoleList();
  syncRolesViewState({ showEmptyHint: state.userRoles.length > 0 });
  if (typeof refreshRoleSelectOptions === "function") {
    refreshRoleSelectOptions();
  }
}
