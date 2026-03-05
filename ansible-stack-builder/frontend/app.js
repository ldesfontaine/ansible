/* ============================================================================
   Ansible Stack Builder — Vanilla JS
   Style Ninite : zéro sélection par défaut, config 100% dynamique
   ============================================================================ */

(function () {
    "use strict";

    const API = window.location.origin;

    // State
    let catalog = null;             // { categories, default_versions, global_config_fields }
    let selected = new Set();       // IDs cochés par l'utilisateur
    let autoEnabled = new Set();    // IDs auto-activés par dépendances
    let allServices = [];           // Flat list
    let defaultVersions = {};
    let globalConfigFields = [];    // Champs globaux
    let configValues = {};          // Valeurs saisies dans la config dynamique

    /** Échappe le HTML pour prévenir les XSS */
    function escapeHtml(str) {
        if (typeof str !== "string") return str;
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // DOM
    const $grid = document.getElementById("services-grid");
    const $warnings = document.getElementById("warnings");
    const $loading = document.getElementById("loading");
    const $generateBtn = document.getElementById("generate-btn");
    const $generateStatus = document.getElementById("generate-status");
    const $configSection = document.getElementById("config-section");
    const $versionsSection = document.getElementById("versions-section");
    const $versionsGrid = document.getElementById("versions-grid");
    const $useLatest = document.getElementById("use_latest");

    // ── Init ──
    async function init() {
        try {
            const res = await fetch(`${API}/api/services`);
            catalog = await res.json();
            defaultVersions = catalog.default_versions || {};
            globalConfigFields = catalog.global_config_fields || [];
            buildServicesList();
            initDefaultConfigValues();
            renderServices();
            initDefaults();
            bindEvents();
            $loading.style.display = "none";
        } catch (err) {
            $loading.textContent = "❌ Erreur de chargement : " + err.message;
        }
    }

    function buildServicesList() {
        allServices = [];
        for (const [catId, cat] of Object.entries(catalog.categories)) {
            for (const svc of cat.services) {
                svc._category = catId;
                allServices.push(svc);
            }
        }
    }

    function getService(id) {
        return allServices.find((s) => s.id === id);
    }

    /** Pré-remplir configValues avec les defaults de tous les champs */
    function initDefaultConfigValues() {
        for (const f of globalConfigFields) {
            if (f.default !== undefined && f.default !== "") {
                configValues[f.id] = f.default;
            }
        }
        for (const svc of allServices) {
            for (const f of (svc.config_fields || [])) {
                if (f.default !== undefined && f.default !== "") {
                    configValues[f.id] = f.default;
                }
            }
        }
    }

    // ── Render services grid (Ninite-style) ──
    function renderServices() {
        $grid.innerHTML = "";
        for (const [catId, cat] of Object.entries(catalog.categories)) {
            const catEl = document.createElement("div");
            catEl.className = "category";
            catEl.innerHTML = `
                <div class="category-header">
                    <span class="category-icon">${escapeHtml(cat.icon)}</span>
                    <h2>${escapeHtml(cat.label)}</h2>
                </div>
                <div class="category-services" id="cat-${escapeHtml(catId)}"></div>
            `;
            $grid.appendChild(catEl);

            const container = catEl.querySelector(".category-services");
            for (const svc of cat.services) {
                const item = document.createElement("label");
                item.className = "service-item";
                item.dataset.id = svc.id;

                const isChecked = selected.has(svc.id) || svc.locked;
                const isAuto = autoEnabled.has(svc.id) && !selected.has(svc.id);

                if (svc.locked) item.classList.add("locked");

                let badge = "";
                if (svc.locked) badge = `<span class="service-badge badge-locked">requis</span>`;
                else if (isAuto) badge = `<span class="service-badge badge-auto">auto</span>`;

                item.innerHTML = `
                    <input type="checkbox"
                        ${isChecked || isAuto ? "checked" : ""}
                        ${svc.locked ? "disabled" : ""}
                        data-id="${escapeHtml(svc.id)}">
                    <div class="service-info">
                        <div class="service-label">${escapeHtml(svc.label)}${badge}</div>
                        <div class="service-desc">${escapeHtml(svc.description)}</div>
                    </div>
                `;
                container.appendChild(item);
            }
        }
    }

    // ── Init defaults: only locked services checked ──
    function initDefaults() {
        for (const svc of allServices) {
            if (svc.locked) {
                selected.add(svc.id);
            }
        }
        resolveDeps();
        refreshUI();
    }

    // ── Dependency resolution (client-side) ──
    function resolveDeps() {
        autoEnabled.clear();
        const allEnabled = new Set(selected);

        for (const svc of allServices) {
            if (svc.locked) allEnabled.add(svc.id);
        }

        let changed = true;
        let iter = 0;
        while (changed && iter < 10) {
            changed = false;
            iter++;
            for (const sid of allEnabled) {
                const svc = getService(sid);
                if (!svc) continue;
                for (const dep of svc.requires) {
                    if (!allEnabled.has(dep)) {
                        allEnabled.add(dep);
                        if (!selected.has(dep)) {
                            autoEnabled.add(dep);
                        }
                        changed = true;
                    }
                }
            }
        }

        // Grafana et Node Exporter requièrent Prometheus —
        // déjà dans "requires", résolu par la boucle ci-dessus.
    }

    /** Get all currently active service IDs (selected + auto + locked) */
    function getActiveServiceIds() {
        const ids = new Set([...selected, ...autoEnabled]);
        for (const svc of allServices) {
            if (svc.locked) ids.add(svc.id);
        }
        return ids;
    }

    // ── Génération de mot de passe conforme CNIL ──
    // 12 caractères min, majuscule + minuscule + chiffre + symbole
    function generatePassword(length = 16) {
        const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const lower = "abcdefghjkmnpqrstuvwxyz";
        const digits = "23456789";
        const symbols = "!@#$%^&*-_=+?";
        const all = upper + lower + digits + symbols;

        const buf = new Uint8Array(length + 4);
        crypto.getRandomValues(buf);

        // Garantir au moins un de chaque catégorie
        const pwd = [
            upper[buf[0] % upper.length],
            lower[buf[1] % lower.length],
            digits[buf[2] % digits.length],
            symbols[buf[3] % symbols.length],
        ];
        for (let i = 4; i < length; i++) {
            pwd.push(all[buf[i] % all.length]);
        }

        // Fisher-Yates shuffle avec des octets aléatoires dédiés
        const shuffle = new Uint8Array(pwd.length);
        crypto.getRandomValues(shuffle);
        for (let i = pwd.length - 1; i > 0; i--) {
            const j = shuffle[i] % (i + 1);
            [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
        }
        return pwd.join("");
    }

    // ── Render dynamic config section ──
    function renderConfig() {
        const activeIds = getActiveServiceIds();

        // Collect required fields (global + services)
        const requiredFields = [];
        const seenIds = new Set();

        // Map: source label → optional fields list
        const optionalBySource = new Map();

        // Global fields
        for (const f of globalConfigFields) {
            if (seenIds.has(f.id)) continue;
            seenIds.add(f.id);
            if (f.required) {
                requiredFields.push({ ...f, _source: "Général" });
            } else {
                if (!optionalBySource.has("🌐 Général")) optionalBySource.set("🌐 Général", []);
                optionalBySource.get("🌐 Général").push({ ...f, _source: "Général" });
            }
        }

        // Service-specific fields
        for (const sid of activeIds) {
            const svc = getService(sid);
            if (!svc) continue;
            const svcFields = svc.config_fields || [];
            if (svcFields.length === 0) continue;

            const groupKey = `${escapeHtml(svc.label)}`;
            for (const f of svcFields) {
                if (seenIds.has(f.id)) continue;
                seenIds.add(f.id);
                if (f.required) {
                    requiredFields.push({ ...f, _source: svc.label });
                } else {
                    if (!optionalBySource.has(groupKey)) optionalBySource.set(groupKey, []);
                    optionalBySource.get(groupKey).push({ ...f, _source: svc.label });
                }
            }
        }

        const hasOptional = [...optionalBySource.values()].some(a => a.length > 0);

        if (requiredFields.length === 0 && !hasOptional) {
            $configSection.classList.add("hidden");
            return;
        }

        $configSection.classList.remove("hidden");

        let html = `<h2 class="section-title">2. Configuration</h2>`;

        // Required fields group
        if (requiredFields.length > 0) {
            html += `<div class="config-group config-group--required">
                <div class="config-group-title"><span class="config-group-icon">⚠️</span> Obligatoire</div>
                <div class="config-grid">`;
            for (const f of requiredFields) {
                html += renderField(f, true);
            }
            html += `</div></div>`;
        }

        // Optional fields — grouped by service
        if (hasOptional) {
            html += `<div class="config-group config-group--optional">
                <div class="config-group-title config-group-title--collapsible" data-target="optional-groups">
                    <span class="config-group-icon">⚙️</span> Optionnel
                    <span class="collapse-arrow">▼</span>
                </div>
                <div id="optional-groups" class="optional-groups">`;

            for (const [groupLabel, fields] of optionalBySource.entries()) {
                if (fields.length === 0) continue;
                const groupId = `optgrp-${groupLabel.replace(/[^a-zA-Z0-9]/g, "_")}`;
                html += `<div class="opt-service-group">
                    <div class="opt-service-title" data-target="${groupId}">
                        ${groupLabel} <span class="collapse-arrow-sm">▾</span>
                    </div>
                    <div id="${groupId}" class="config-grid opt-service-fields">`;
                for (const f of fields) {
                    html += renderField(f, false);
                }
                html += `</div></div>`;
            }
            html += `</div></div>`;
        }

        $configSection.innerHTML = html;

        // Collapsible "Optionnel" block
        const optTitle = $configSection.querySelector(".config-group-title--collapsible");
        if (optTitle) {
            optTitle.addEventListener("click", () => {
                const target = document.getElementById(optTitle.dataset.target);
                const arrow = optTitle.querySelector(".collapse-arrow");
                if (target) {
                    target.classList.toggle("collapsed");
                    arrow.textContent = target.classList.contains("collapsed") ? "▶" : "▼";
                }
            });
        }

        // Collapsible service sub-groups
        $configSection.querySelectorAll(".opt-service-title").forEach(title => {
            title.addEventListener("click", () => {
                const target = document.getElementById(title.dataset.target);
                const arrow = title.querySelector(".collapse-arrow-sm");
                if (target) {
                    target.classList.toggle("collapsed");
                    arrow.textContent = target.classList.contains("collapsed") ? "▸" : "▾";
                }
            });
        });

        // Password generation buttons
        $configSection.querySelectorAll(".btn-gen-pwd").forEach(btn => {
            btn.addEventListener("click", () => {
                const targetId = btn.dataset.target;
                const inp = document.getElementById(targetId);
                if (inp) {
                    const pwd = generatePassword(16);
                    inp.value = pwd;
                    inp.type = "text"; // show briefly
                    configValues[inp.dataset.configId] = pwd;
                    inp.classList.add("pwd-generated");
                    setTimeout(() => {
                        inp.type = "password";
                        inp.classList.remove("pwd-generated");
                    }, 2000);
                    validateConfig();
                    // Copy to clipboard
                    navigator.clipboard.writeText(pwd).catch(() => {});
                }
            });
        });

        // Toggle password visibility
        $configSection.querySelectorAll(".btn-toggle-pwd").forEach(btn => {
            btn.addEventListener("click", () => {
                const inp = document.getElementById(btn.dataset.target);
                if (inp) {
                    inp.type = inp.type === "password" ? "text" : "password";
                    btn.textContent = inp.type === "password" ? "👁" : "🙈";
                }
            });
        });

        // Bind input events for live validation
        $configSection.querySelectorAll("input[data-config-id], select[data-config-id]").forEach(inp => {
            inp.addEventListener("input", onConfigInput);
            inp.addEventListener("change", onConfigInput);
        });

        validateConfig();
    }

    function renderField(field, isRequired) {
        const val = configValues[field.id] !== undefined ? configValues[field.id] : (field.default !== undefined ? field.default : "");
        const star = isRequired ? `<span class="required-star">*</span>` : "";
        const safeLabel = escapeHtml(field.label);
        const safeId = escapeHtml(field.id);
        const helpHtml = field.help
            ? `<span class="field-help" title="${escapeHtml(field.help)}">ⓘ</span>`
            : "";

        // ── Checkbox ──
        if (field.type === "checkbox") {
            const checked = val === true || val === "true" ? "checked" : "";
            return `<div class="config-field">
                <label class="checkbox-label">
                    <input type="checkbox" data-config-id="${safeId}" ${checked}>
                    ${safeLabel}${helpHtml}
                </label>
            </div>`;
        }

        // ── Select ──
        if (field.type === "select") {
            const safeVal = escapeHtml(String(val));
            const options = (field.options || []).map(opt => {
                const safeOpt = escapeHtml(String(opt));
                const selected = safeOpt === safeVal ? "selected" : "";
                return `<option value="${safeOpt}" ${selected}>${safeOpt}</option>`;
            }).join("");
            return `<div class="config-field">
                <label for="cfg-${safeId}">${safeLabel}${star}${helpHtml}</label>
                <select id="cfg-${safeId}" data-config-id="${safeId}" data-required="${isRequired}">
                    ${options}
                </select>
            </div>`;
        }

        // ── Password ──
        if (field.type === "password") {
            const safeVal = escapeHtml(String(val));
            const safePlaceholder = escapeHtml(field.placeholder || "");
            return `<div class="config-field config-field--password">
                <label for="cfg-${safeId}">${safeLabel}${star}${helpHtml}</label>
                <div class="pwd-input-row">
                    <input type="password" id="cfg-${safeId}"
                        data-config-id="${safeId}"
                        data-required="${isRequired}"
                        value="${safeVal}"
                        placeholder="${safePlaceholder}"
                        autocomplete="new-password">
                    <button type="button" class="btn-toggle-pwd" data-target="cfg-${safeId}" title="Afficher/masquer">👁</button>
                </div>
                <button type="button" class="btn-gen-pwd" data-target="cfg-${safeId}"
                    title="Générer un mot de passe fort (CNIL : 16 car., maj+min+chiffre+symbole)">🎲 Générer un mot de passe fort</button>
            </div>`;
        }

        // ── Text / Email / Number ──
        const typeMap = { number: "number", email: "email" };
        const inputType = typeMap[field.type] || "text";
        const minAttr = field.min !== undefined ? `min="${field.min}"` : "";
        const maxAttr = field.max !== undefined ? `max="${field.max}"` : "";
        const safeVal = escapeHtml(String(val));
        const safePlaceholder = escapeHtml(field.placeholder || "");

        return `<div class="config-field">
            <label for="cfg-${safeId}">${safeLabel}${star}${helpHtml}</label>
            <input type="${inputType}" id="cfg-${safeId}"
                data-config-id="${safeId}"
                data-required="${isRequired}"
                value="${safeVal}"
                placeholder="${safePlaceholder}"
                ${minAttr} ${maxAttr}>
        </div>`;
    }

    function onConfigInput(e) {
        const inp = e.target;
        const id = inp.dataset.configId;
        if (inp.type === "checkbox") {
            configValues[id] = inp.checked;
        } else {
            configValues[id] = inp.value;
        }
        validateConfig();
    }

    /** Regex pour valider le nom de projet (cohérent avec le backend) */
    const PROJECT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

    /** Validate required fields → toggle generate button + field-error class */
    function validateConfig() {
        let allValid = true;
        // inputs requis
        $configSection.querySelectorAll("input[data-required='true']").forEach(inp => {
            const val = inp.value.trim();
            if (!val) {
                inp.classList.add("field-error");
                allValid = false;
            } else {
                inp.classList.remove("field-error");
            }
        });
        // selects requis
        $configSection.querySelectorAll("select[data-required='true']").forEach(sel => {
            if (!sel.value) {
                sel.classList.add("field-error");
                allValid = false;
            } else {
                sel.classList.remove("field-error");
            }
        });

        // Valider le format du nom de projet (si le champ existe)
        const projectNameInput = $configSection.querySelector('input[data-config-id="project_name"]');
        if (projectNameInput && projectNameInput.value.trim()) {
            if (!PROJECT_NAME_RE.test(projectNameInput.value.trim())) {
                projectNameInput.classList.add("field-error");
                allValid = false;
            }
        }

        $generateBtn.disabled = !allValid;
    }

    // ── Render versions ──
    function renderVersions() {
        const activeIds = getActiveServiceIds();
        let hasVersionService = false;

        $versionsGrid.innerHTML = "";
        for (const svc of allServices) {
            if (!svc.has_version) continue;
            const isActive = activeIds.has(svc.id);
            if (!isActive) continue;
            hasVersionService = true;

            const field = document.createElement("div");
            field.className = "config-field";
            field.id = `version-field-${svc.id}`;
            field.innerHTML = `
                <label for="version-${svc.id}">${svc.label}</label>
                <input type="text" id="version-${svc.id}"
                    value="${defaultVersions[svc.id] || 'latest'}"
                    data-service="${svc.id}">
            `;
            $versionsGrid.appendChild(field);
        }

        $versionsSection.classList.toggle("hidden", !hasVersionService);
    }

    // ── Refresh all UI ──
    function refreshUI() {
        // Update checkboxes
        document.querySelectorAll('.service-item').forEach(item => {
            const id = item.dataset.id;
            const cb = item.querySelector('input[type="checkbox"]');
            const svc = getService(id);
            const isSelected = selected.has(id);
            const isAuto = autoEnabled.has(id);
            const isChecked = isSelected || isAuto || (svc && svc.locked);

            cb.checked = isChecked;
            item.classList.toggle("auto-enabled", isAuto && !isSelected);

            // Update badge
            const existingBadge = item.querySelector('.service-badge');
            if (existingBadge) existingBadge.remove();
            const labelEl = item.querySelector('.service-label');
            if (svc && svc.locked) {
                labelEl.insertAdjacentHTML('beforeend', '<span class="service-badge badge-locked">requis</span>');
            } else if (isAuto) {
                labelEl.insertAdjacentHTML('beforeend', '<span class="service-badge badge-auto">auto</span>');
            }
        });

        // Warnings
        updateWarnings();

        // Dynamic config
        renderConfig();

        // Versions
        renderVersions();
    }

    function updateWarnings() {
        const allEnabled = new Set([...selected, ...autoEnabled]);
        const warns = [];
        const seenConflicts = new Set();
        for (const svc of allServices) {
            if (svc.warning_if_disabled && !allEnabled.has(svc.id)) {
                warns.push(svc.warning_if_disabled);
            }
            // Afficher un warning si conflit détecté (pas bloquant)
            if (svc.conflicts_with && allEnabled.has(svc.id)) {
                for (const cid of svc.conflicts_with) {
                    if (allEnabled.has(cid)) {
                        const pair = [svc.id, cid].sort().join("+");
                        if (!seenConflicts.has(pair)) {
                            seenConflicts.add(pair);
                            const csvc = getService(cid);
                            warns.push(`⚠️ ${svc.label} et ${csvc ? csvc.label : cid} utilisent le même port DNS par défaut (53). Modifiez le port DNS de l'un des deux dans la configuration ci-dessous.`);
                        }
                    }
                }
            }
        }
        if (warns.length > 0) {
            $warnings.classList.remove("hidden");
            $warnings.innerHTML = warns.map(w => `<div class="warning-item">${w}</div>`).join("");
        } else {
            $warnings.classList.add("hidden");
        }
    }

    // ── Events ──
    function bindEvents() {
        // Service checkboxes
        $grid.addEventListener("change", (e) => {
            const cb = e.target;
            if (cb.type !== "checkbox") return;
            const id = cb.dataset.id;
            const svc = getService(id);
            if (!svc || svc.locked) return;

            if (cb.checked) {
                selected.add(id);
                autoEnabled.delete(id);
            } else {
                selected.delete(id);
            }
            resolveDeps();
            refreshUI();
        });

        // Prevent clicking on locked items
        $grid.addEventListener("click", (e) => {
            const item = e.target.closest(".service-item.locked");
            if (item) e.preventDefault();
        });

        // Use latest toggle
        $useLatest.addEventListener("change", () => {
            const inputs = $versionsGrid.querySelectorAll("input[type='text']");
            inputs.forEach(inp => {
                if ($useLatest.checked) {
                    inp.dataset.savedVersion = inp.value;
                    inp.value = "latest";
                    inp.disabled = true;
                } else {
                    inp.value = inp.dataset.savedVersion || defaultVersions[inp.dataset.service] || "latest";
                    inp.disabled = false;
                }
            });
        });

        // Generate button
        $generateBtn.addEventListener("click", generate);
    }

    // ── Collect all config values from dynamic fields ──
    function collectVariables() {
        const variables = {};

        // Collect from dynamic config fields (inputs + selects)
        $configSection.querySelectorAll("input[data-config-id], select[data-config-id]").forEach(inp => {
            const id = inp.dataset.configId;
            if (inp.tagName === "SELECT") {
                variables[id] = inp.value;
            } else if (inp.type === "checkbox") {
                variables[id] = inp.checked;
            } else if (inp.type === "number") {
                variables[id] = parseInt(inp.value) || inp.value;
            } else {
                variables[id] = inp.value;
            }
        });

        // Ensure defaults for unset optional fields from active services
        const activeIds = getActiveServiceIds();
        for (const sid of activeIds) {
            const svc = getService(sid);
            if (!svc) continue;
            for (const f of (svc.config_fields || [])) {
                if (variables[f.id] === undefined && f.default !== undefined) {
                    variables[f.id] = f.default;
                }
            }
        }

        // Defaults from global
        for (const f of globalConfigFields) {
            if (variables[f.id] === undefined && f.default !== undefined) {
                variables[f.id] = f.default;
            }
        }

        return variables;
    }

    // ── Generate ──
    async function generate() {
        $generateBtn.disabled = true;
        $generateBtn.classList.add("loading");
        $generateStatus.textContent = "Génération en cours…";
        $generateStatus.className = "generate-status";

        try {
            const services = [...getActiveServiceIds()];
            const variables = collectVariables();
            const projectName = variables.project_name || "my-stack";

            // Collect versions
            const versions = {};
            if ($useLatest.checked) {
                for (const svc of allServices) {
                    if (svc.has_version) versions[svc.id] = "latest";
                }
            } else {
                $versionsGrid.querySelectorAll("input[data-service]").forEach(inp => {
                    versions[inp.dataset.service] = inp.value;
                });
            }

            const res = await fetch(`${API}/api/generate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ services, variables, versions }),
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.errors ? err.errors.join(", ") : "Erreur serveur");
            }

            // Download the ZIP
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `${projectName}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            $generateStatus.textContent = "✅ Stack téléchargée !";
            $generateStatus.className = "generate-status success";
        } catch (err) {
            $generateStatus.textContent = "❌ " + err.message;
            $generateStatus.className = "generate-status error";
        } finally {
            $generateBtn.disabled = false;
            $generateBtn.classList.remove("loading");
            validateConfig();
        }
    }

    // GO
    init();
})();
