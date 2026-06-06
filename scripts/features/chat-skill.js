"use strict";

// ── 技能库：目前仅"问卷式交互"一项 ──

const SKILL_ITEMS = [
  {
    id: "questionnaire",
    icon: "clipboard-list",
    name: "问卷式交互",
    desc: "模型驱动的结构化提问，通过交互式卡片逐步引导你回答问题。",
    triggers: ["/问卷", "/questionnaire"],
    scenarios: [
      "需求分析 — 梳理和分析需求，明确目标与边界",
      "方案设计 — 逐步设计方案，考虑各种可行路径",
      "问题排查 — 系统性定位和排查问题根因",
      "情感分析 — 分析情绪和情感倾向，理解背后的动机",
      "任何需要逐步引导用户思考的场景",
    ],
    prompt: [
      "## 结构化提问技能",
      "",
      "当你需要引导用户逐步分析问题时，可以使用结构化提问技能。",
      "",
      "### 使用场景",
      "- 需求分析",
      "- 方案设计",
      "- 问题排查",
      "- 情感分析",
      "- 任何需要逐步引导用户思考的场景",
      "",
      "### 格式要求",
      "使用以下格式发起提问：",
      "",
      "[[SKILL_START]]",
      '{  "type": "structured_question",',
      '  "skill_name": "技能名称",',
      '  "question": "当前问题",',
      '  "options": [',
      '    {"id": "opt1", "text": "选项1"},',
      '    {"id": "opt2", "text": "选项2"},',
      '    {"id": "opt3", "text": "选项3"}',
      "  ],",
      '  "allow_custom": true,',
      '  "step": 1,',
      '  "total_steps": 5,',
      '  "context": {}',
      "}",
      "[[SKILL_END]]",
      "",
      "### 规则",
      "1. 最多 5 个问题",
      "2. 每次提供 3 个选项 + 可选的自定义输入",
      "3. 问题要逐步深入，从宏观到微观",
      "4. 每个问题只问一件事",
      "5. 选项要互斥且覆盖主要情况",
      "",
      "### 结束格式",
      "当所有问题回答完毕，使用以下格式返回结果：",
      "",
      "[[SKILL_COMPLETE]]",
      '{  "skill_name": "技能名称",',
      '  "summary": { "key1": "value1", "key2": "value2" }',
      "}",
      "[[SKILL_COMPLETE_END]]",
    ].join("\n"),
  },
];

// ── 初始化技能面板 ──

function initSkillsView() {
  const listEl = document.getElementById("skillList");
  const contentEl = document.getElementById("skillDetailContent");
  const detailPanel = document.getElementById("skillDetailPanel");
  const emptyState = document.getElementById("skillEmptyState");
  if (!listEl || !contentEl) return;

  // 渲染左侧技能列表
  listEl.innerHTML = "";
  SKILL_ITEMS.forEach((skill) => {
    const item = document.createElement("div");
    item.className = "skill-library-item";
    item.dataset.skillId = skill.id;
    item.setAttribute("tabindex", "0");
    item.setAttribute("role", "button");

    const top = document.createElement("div");
    top.className = "skill-library-item-top";

    const icon = document.createElement("i");
    icon.setAttribute("data-lucide", skill.icon);
    icon.className = "skill-library-item-icon";
    top.appendChild(icon);

    const name = document.createElement("span");
    name.className = "skill-library-item-name";
    name.textContent = skill.name;
    top.appendChild(name);

    item.appendChild(top);

    const desc = document.createElement("p");
    desc.className = "skill-library-item-desc";
    desc.textContent = skill.desc;
    item.appendChild(desc);

    item.addEventListener("click", () => {
      document.querySelectorAll(".skill-library-item").forEach((b) => b.classList.remove("active"));
      item.classList.add("active");
      if (emptyState) emptyState.style.display = "none";
      if (detailPanel) detailPanel.style.display = "block";
      renderSkillDetail(skill, contentEl);
    });

    listEl.appendChild(item);
  });

  // 默认选中第一个
  const first = listEl.querySelector(".skill-library-item");
  if (first) {
    first.classList.add("active");
    if (emptyState) emptyState.style.display = "none";
    if (detailPanel) detailPanel.style.display = "block";
    renderSkillDetail(SKILL_ITEMS[0], contentEl);
  }

  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}

// ── 渲染技能详情（右侧面板） ──

function renderSkillDetail(skill, container) {
  const triggersHtml = skill.triggers
    .map((t) => `<code class="skill-trigger-code">${escapeHtml(t)}</code>`)
    .join(" ");

  const scenariosHtml = skill.scenarios
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");

  // 对 prompt 做基本的转义 + 保留换行
  const promptHtml = escapeHtml(skill.prompt).replace(/\n/g, "<br>");

  container.innerHTML = `
    <section class="settings-card">
      <div class="settings-card-head">
        <div>
          <h3>${escapeHtml(skill.name)}</h3>
          <p class="hint-text">${escapeHtml(skill.desc)}</p>
        </div>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h3>触发命令</h3>
      </div>
      <div class="settings-card-body">
        <p class="hint-text">在工作模式聊天中输入以下命令手动触发结构化提问：</p>
        <div class="skill-trigger-row">${triggersHtml}</div>
        <p class="hint-text" style="margin-top:8px">中英文均可，模型收到后自动进入问卷式交互流程。</p>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h3>使用场景</h3>
      </div>
      <div class="settings-card-body">
        <ul class="skill-scenario-list">${scenariosHtml}</ul>
      </div>
    </section>

    <section class="settings-card">
      <div class="settings-card-head">
        <h3>系统 Prompt</h3>
      </div>
      <div class="settings-card-body">
        <div class="skill-prompt-block">${promptHtml}</div>
      </div>
    </section>
  `;

  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}


// ═══════════════════════════════════════════════
//  以下为运行时功能：解析、渲染、处理 不作改动
// ═══════════════════════════════════════════════

function parseSkillFromResponse(content) {
  if (!content || typeof content !== "string") return null;
  const startMatch = content.match(/\[\[SKILL_START\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_END\]\]/);
  if (!startMatch) return null;
  try { return JSON.parse(startMatch[1]); }
  catch (e) { console.warn("[skill] Failed to parse skill JSON:", e); return null; }
}

function parseSkillResult(content) {
  if (!content || typeof content !== "string") return null;
  const match = content.match(/\[\[SKILL_COMPLETE\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_COMPLETE_END\]\]/);
  if (!match) return null;
  try { return JSON.parse(match[1]); }
  catch (e) { console.warn("[skill] Failed to parse skill result:", e); return null; }
}

function getSkillResponseRenderState(content) {
  const raw = typeof content === "string" ? content : "";
  const markers = ["[[SKILL_START]]", "[[SKILL_COMPLETE]]"];
  let markerIndex = -1;

  markers.forEach(function(marker) {
    const index = raw.indexOf(marker);
    if (index !== -1 && (markerIndex === -1 || index < markerIndex)) {
      markerIndex = index;
    }
  });

  if (markerIndex === -1) {
    markers.forEach(function(marker) {
      for (let length = 1; length < marker.length; length += 1) {
        const prefix = marker.slice(0, length);
        if (raw.endsWith(prefix)) {
          const index = raw.length - length;
          if (markerIndex === -1 || index < markerIndex) {
            markerIndex = index;
          }
        }
      }
    });
  }

  if (markerIndex === -1) {
    return {
      visibleText: raw,
      skillData: null,
      skillResult: null,
      buffering: false,
    };
  }

  return {
    visibleText: raw.slice(0, markerIndex).trimEnd(),
    skillData: parseSkillFromResponse(raw),
    skillResult: parseSkillResult(raw),
    buffering: true,
  };
}

function isQuestionnaireActive(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  let awaitingAnswer = false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    const content = typeof message?.content === "string" ? message.content : "";
    if (!content || message.pending) continue;

    if (message.role === "assistant") {
      if (content.includes("[[SKILL_COMPLETE]]")) return false;
      if (content.includes("[[SKILL_START]]")) {
        awaitingAnswer = true;
        continue;
      }
    }

    if (message.role === "user") {
      if (message._noBubble && content.startsWith("[技能回答]")) {
        return true;
      }
      if (!message._noBubble) {
        const normalized = content.trim().toLowerCase();
        const isTrigger = normalized === "/问卷"
          || normalized.startsWith("/问卷 ")
          || normalized === "/questionnaire"
          || normalized.startsWith("/questionnaire ");
        return isTrigger && !awaitingAnswer;
      }
    }
  }

  return false;
}

function renderSkillCard(skillData, messageId) {
  const card = document.createElement("div");
  card.className = "skill-bubble";
  card.dataset.messageId = messageId;
  const session = typeof getCurrentSession === "function" ? getCurrentSession() : null;
  const hasContinuation = (session?.messages || []).some(function(message) {
    return message?._skillContinuationOf === messageId;
  });
  if (hasContinuation) {
    card.classList.add("skill-bubble-locked", "skill-bubble-answered");
  }
  const header = document.createElement("div");
  header.className = "skill-bubble-header";
  header.innerHTML = '<span class="skill-bubble-name">' + escapeHtml(skillData.skill_name) + '</span><span class="skill-bubble-step">(' + skillData.step + '/' + skillData.total_steps + ')</span>';
  card.appendChild(header);
  const question = document.createElement("div");
  question.className = "skill-bubble-question";
  question.textContent = skillData.question;
  card.appendChild(question);
  const optionsContainer = document.createElement("div");
  optionsContainer.className = "skill-bubble-options";
  (skillData.options || []).forEach(function(option) {
    const optBtn = document.createElement("button");
    optBtn.type = "button"; optBtn.className = "skill-bubble-opt";
    optBtn.textContent = option.text;
    optBtn.addEventListener("click", function() { handleSkillAnswer(skillData.skill_name, skillData.step, option.id, option.text, null, messageId); });
    optionsContainer.appendChild(optBtn);
  });
  if (skillData.allow_custom) {
    const customRow = document.createElement("div"); customRow.className = "skill-bubble-custom";
    const input = document.createElement("input"); input.type = "text"; input.className = "skill-bubble-custom-input"; input.placeholder = "自定义输入..."; input.maxLength = 500;
    const sendBtn = document.createElement("button"); sendBtn.type = "button"; sendBtn.className = "skill-bubble-custom-btn"; sendBtn.textContent = "发送";
    const doSend = function() { var text = input.value.trim(); if (text) handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, text, messageId); };
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", function(e) { if (e.key === "Enter") doSend(); });
    customRow.appendChild(input); customRow.appendChild(sendBtn); optionsContainer.appendChild(customRow);
  }
  card.appendChild(optionsContainer);
  return card;
}

function renderSkillResult(skillResult) {
  const card = document.createElement("div");
  card.className = "skill-bubble skill-bubble-result";
  const header = document.createElement("div"); header.className = "skill-bubble-header"; header.innerHTML = '<span class="skill-bubble-name">' + escapeHtml(skillResult.skill_name) + ' - 完成</span>'; card.appendChild(header);
  const body = document.createElement("div"); body.className = "skill-bubble-body";
  const summary = skillResult.summary || {};
  const html = Object.entries(summary).map(function(kv) { return '<div class="skill-result-line"><strong>' + escapeHtml(kv[0]) + ':</strong> ' + escapeHtml(String(kv[1])) + '</div>'; }).join("");
  body.innerHTML = html || "分析完成"; card.appendChild(body);
  return card;
}

function handleSkillAnswer(skillName, step, optionId, optionText, customText, messageId) {
  const label = optionId === "custom" ? customText : optionText;
  const text = "[技能回答] " + skillName + " 第" + step + "步: " + label;

  // 锁定当前卡片
  lockSkillCard(messageId);

  // 静默发送：不渲染用户气泡，直接将回答注入会话并触发 AI 下一轮
  if (typeof getCurrentSession !== "function" || typeof runSessionTurn !== "function") return;
  const session = getCurrentSession();
  if (!session) return;
  const sourceMessage = (session.messages || []).find(function(message) {
    return message?.id === messageId && message.role === "assistant";
  });
  session._skillContinuation = {
    sourceMessageId: messageId,
    speaker: sourceMessage?.speaker || "",
  };

  // 沿用 sendUserMessage 的状态管理
  if (typeof state !== "undefined" && state) {
    if (state.isSending) return;
    state.isSending = true;
    if (state._lastAbortAt && Date.now() - state._lastAbortAt < 400) return;
  }
  if (els.sendBtn) els.sendBtn.disabled = true;
  if (els.chatInput) els.chatInput.disabled = true;
  if (typeof window.__cancelAutoTtsTurn === "function") window.__cancelAutoTtsTurn();

  // 添加用户消息（带 _noBubble 标记，renderMessages 会跳过渲染）
  const msg = {
    id: typeof createMessageId === "function" ? createMessageId("user") : "user_" + Date.now(),
    role: "user",
    speaker: "你",
    content: text,
    createdAt: new Date().toISOString(),
    _noBubble: true,
  };
  session.messages.push(msg);

  // 触发 AI 响应
  runSessionTurn(session);
}

function lockSkillCard(messageId) {
  const card = document.querySelector('.skill-bubble[data-message-id="' + messageId + '"]');
  if (!card) return;
  card.classList.add("skill-bubble-locked", "skill-bubble-answered");
  card.querySelectorAll(".skill-bubble-opt, .skill-bubble-custom-btn, .skill-bubble-custom-input").forEach(function(el) { el.disabled = true; });
}

function isSkillMessage(content) {
  if (!content || typeof content !== "string") return false;
  return content.indexOf("[[SKILL_START]]") !== -1 || content.indexOf("[[SKILL_ANSWER]]") !== -1 || content.indexOf("[[SKILL_COMPLETE]]") !== -1;
}
