"use strict";

// 解析模型响应中的技能标识
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

// 检查流程是否完成
function isSkillComplete(content) {
  if (!content || typeof content !== "string") return false;
  return content.includes("[[SKILL_COMPLETE]]");
}

// 解析最终结果
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

// 渲染技能卡片
function renderSkillCard(skillData, messageId) {
  const card = document.createElement("div");
  card.className = "skill-card";
  card.dataset.messageId = messageId;
  card.dataset.skillName = skillData.skill_name;
  card.dataset.step = skillData.step;
  
  // 头部
  const header = document.createElement("div");
  header.className = "skill-card-header";
  header.innerHTML = `
    <span class="skill-card-icon">📋</span>
    <span class="skill-card-title">${escapeHtml(skillData.skill_name)}</span>
    <span class="skill-card-progress">(${skillData.step}/${skillData.total_steps})</span>
  `;
  card.appendChild(header);
  
  // 问题
  const question = document.createElement("div");
  question.className = "skill-card-question";
  question.textContent = skillData.question;
  card.appendChild(question);
  
  // 选项容器
  const optionsContainer = document.createElement("div");
  optionsContainer.className = "skill-card-options";
  
  // 选项按钮
  (skillData.options || []).forEach((option) => {
    const optionBtn = document.createElement("button");
    optionBtn.type = "button";
    optionBtn.className = "skill-card-option";
    optionBtn.dataset.optionId = option.id;
    optionBtn.textContent = option.text;
    optionBtn.addEventListener("click", () => {
      handleSkillAnswer(skillData.skill_name, skillData.step, option.id, null, messageId);
    });
    optionsContainer.appendChild(optionBtn);
  });
  
  // 自定义输入
  if (skillData.allow_custom) {
    const customContainer = document.createElement("div");
    customContainer.className = "skill-card-custom";
    
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.className = "skill-card-custom-input";
    customInput.placeholder = "自定义输入...";
    
    const customBtn = document.createElement("button");
    customBtn.type = "button";
    customBtn.className = "skill-card-custom-btn";
    customBtn.textContent = "发送";
    customBtn.addEventListener("click", () => {
      const text = customInput.value.trim();
      if (text) {
        handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, messageId);
      }
    });
    
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const text = customInput.value.trim();
        if (text) {
          handleSkillAnswer(skillData.skill_name, skillData.step, "custom", text, messageId);
        }
      }
    });
    
    customContainer.appendChild(customInput);
    customContainer.appendChild(customBtn);
    optionsContainer.appendChild(customContainer);
  }
  
  card.appendChild(optionsContainer);
  
  return card;
}

// 渲染技能结果卡片
function renderSkillResult(skillResult) {
  const card = document.createElement("div");
  card.className = "skill-card skill-card-result";
  
  // 头部
  const header = document.createElement("div");
  header.className = "skill-card-header";
  header.innerHTML = `
    <span class="skill-card-icon">✅</span>
    <span class="skill-card-title">${escapeHtml(skillResult.skill_name)} - 完成</span>
  `;
  card.appendChild(header);
  
  // 结果内容
  const content = document.createElement("div");
  content.className = "skill-card-content";
  
  const summary = skillResult.summary || {};
  const summaryHtml = Object.entries(summary)
    .map(([key, value]) => `<div class="skill-result-item"><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</div>`)
    .join("");
  
  content.innerHTML = summaryHtml || "<div>分析完成</div>";
  card.appendChild(content);
  
  return card;
}

// 处理用户选择
function handleSkillAnswer(skillName, step, optionId, customText, messageId) {
  // 构造答案消息
  const answerData = {
    skill_name: skillName,
    step: step,
    selected_option_id: optionId,
    custom_text: customText,
    timestamp: new Date().toISOString()
  };
  
  const answerMessage = `[[SKILL_ANSWER]]\n${JSON.stringify(answerData, null, 2)}\n[[SKILL_ANSWER_END]]`;
  
  // 发送给模型
  if (typeof sendUserMessage === "function") {
    els.chatInput.value = answerMessage;
    sendUserMessage();
  }
  
  // 锁定当前卡片
  lockSkillCard(messageId);
}

// 锁定技能卡片
function lockSkillCard(messageId) {
  const card = document.querySelector(`.skill-card[data-message-id="${messageId}"]`);
  if (!card) return;
  
  card.classList.add("skill-card-locked");
  
  // 禁用所有选项按钮
  card.querySelectorAll(".skill-card-option, .skill-card-custom-btn, .skill-card-custom-input").forEach((el) => {
    el.disabled = true;
  });
  

}