"use strict";

// ── 二级侧栏 ──

function toggleSkillSidebar() {
  const sidebar = document.getElementById("chatSkillSidebar");
  const stage = document.getElementById("chatStage");
  const detail = document.getElementById("chatSkillDetail");
  if (!sidebar) return;

  const isOpen = !sidebar.classList.contains("hidden");
  sidebar.classList.toggle("hidden");

  if (isOpen) {
    // 关闭技能侧栏 → 恢复聊天
    if (stage) stage.classList.remove("hidden");
    if (detail) detail.classList.add("hidden");
    document.querySelectorAll(".chat-skill-item").forEach((b) => b.classList.remove("active"));
  }
  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}

// 初始化技能面板（绑定二级侧栏内的 item 点击）
function initSkillsView() {
  const items = document.querySelectorAll(".chat-skill-item");
  items.forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".chat-skill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const stage = document.getElementById("chatStage");
      const detail = document.getElementById("chatSkillDetail");
      if (stage) stage.classList.add("hidden");
      if (detail) detail.classList.remove("hidden");
    });
  });
  if (typeof lucide !== "undefined" && lucide.createIcons) {
    lucide.createIcons();
  }
}

// ── 解析模型响应中的技能标识 ──

function parseSkillFromResponse(content) {
  if (!content || typeof content !== "string") return null;

  const startMatch = content.match(/\[\[SKILL_START\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_END\]\]/);
  if (!startMatch) return null;

  try {
    return JSON.parse(startMatch[1]);
  } catch (e) {
    console.warn("[skill] Failed to parse skill JSON:", e);
    return null;
  }
}

function parseSkillResult(content) {
  if (!content || typeof content !== "string") return null;

  const match = content.match(/\[\[SKILL_COMPLETE\]\]\s*(\{[\s\S]*?\})\s*\[\[SKILL_COMPLETE_END\]\]/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch (e) {
    console.warn("[skill] Failed to parse skill result:", e);
    return null;
  }
}

// ── 渲染技能卡片（AI 气泡风格） ──

function renderSkillCard(skillData, messageId) {
  const card = document.createElement("div");
  card.className = "skill-bubble";
  card.dataset.messageId = messageId;

  const header = document.createElement("div");
  header.className = "skill-bubble-header";
  header.innerHTML = `
    <span class="skill-bubble-name">${escapeHtml(skillData.skill_name)}</span>
    <span class="skill-bubble-step">(${skillData.step}/${skillData.total_steps})</span>
  `;
  card.appendChild(header);

  const question = document.createElement("div");
  question.className = "skill-bubble-question";
  question.textContent = skillData.question;
  card.appendChild(question);

  const optionsContainer = document.createElement("div");
  optionsContainer.className = "skill-bubble-options";

  (skillData.options || []).forEach((option) => {
    const optBtn = document.createElement("button");
    optBtn.type = "button";
    optBtn.className = "skill-bubble-opt";
    optBtn.textContent = option.text;
    optBtn.addEventListener("click", () => {
      handleSkillAnswer(skillData.skill_name, skillData.step, option.id, option.text, null, messageId);
    });
    optionsContainer.appendChild(optBtn);
  });

  if (skillData.allow_custom) {
    const customRow = document.createElement("div");
    customRow.className = "skill-bubble-custom";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "skill-bubble-custom-input";
    input.placeholder = "自定义输入...";
    input.maxLength = 500;

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "skill-bubble-custom-btn";
    sendBtn.textContent = "发送";

    const doSend = () => {
      const text = input.value.trim();
      if (text) {
        handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, text, messageId);
      }
    };

    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doSend();
    });

    customRow.appendChild(input);
    customRow.appendChild(sendBtn);
    optionsContainer.appendChild(customRow);
  }

  card.appendChild(optionsContainer);
  return card;
}

function renderSkillResult(skillResult) {
  const card = document.createElement("div");
  card.className = "skill-bubble skill-bubble-result";

  const header = document.createElement("div");
  header.className = "skill-bubble-header";
  header.innerHTML = `<span class="skill-bubble-name">${escapeHtml(skillResult.skill_name)} - 完成</span>`;
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "skill-bubble-body";

  const summary = skillResult.summary || {};
  const html = Object.entries(summary)
    .map(([k, v]) => `<div class="skill-result-line"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</div>`)
    .join("");

  body.innerHTML = html || "分析完成";
  card.appendChild(body);

  return card;
}

// ── 答案格式：纯文本，不输出代码 ──

function handleSkillAnswer(skillName, step, optionId, optionText, customText, messageId) {
  const label = optionId === "custom" ? customText : optionText;
  const text = `[技能回答] ${skillName} 第${step}步: ${label}`;

  if (typeof sendUserMessage === "function") {
    els.chatInput.value = text;
    if (typeof window.__cancelAutoTtsTurn === "function") {
      window.__cancelAutoTtsTurn();
    }
    sendUserMessage();
  }

  lockSkillCard(messageId);
}

function lockSkillCard(messageId) {
  const card = document.querySelector(`.skill-bubble[data-message-id="${messageId}"]`);
  if (!card) return;
  card.classList.add("skill-bubble-locked");
  card.querySelectorAll(".skill-bubble-opt, .skill-bubble-custom-btn, .skill-bubble-custom-input").forEach((el) => {
    el.disabled = true;
  });
}

// ── TTS 跳过：在消息中标记 ──

function isSkillMessage(content) {
  if (!content || typeof content !== "string") return false;
  return content.includes("[[SKILL_START]]") || content.includes("[[SKILL_ANSWER]]") || content.includes("[[SKILL_COMPLETE]]");
}
