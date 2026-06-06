"use strict";

function beginUserMessageEdit(messageId) {
  if (state.isSending) {
    return;
  }

  const session = getCurrentSession();
  if (!session) {
    return;
  }

  const target = session.messages.find((message) => message.id === messageId && message.role === "user");
  if (!target) {
    return;
  }

  state.editingUserMessageId = messageId;
  state.openUserMessageToolsId = null;
  els.chatInput.disabled = false;
  els.sendBtn.disabled = false;
  els.chatInput.value = target.content || "";
  autoResizeChatInput();
  updateComposerMode();
  queueMicrotask(() => {
    els.chatInput.focus();
    els.chatInput.setSelectionRange(els.chatInput.value.length, els.chatInput.value.length);
  });
  renderMessages();
}

function clearUserMessageEdit() {
  state.editingUserMessageId = null;
  state.openUserMessageToolsId = null;
  if (!state.isSending) {
    els.chatInput.value = "";
    autoResizeChatInput();
  }
  updateComposerMode();
  renderMessages();
}

function copyMessageContent(messageId, iconEl) {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const message = session.messages.find((m) => m.id === messageId);
  if (!message || !message.content) {
    return;
  }

  const showCopied = () => {
    setText(els.chatStatus, t("chat.copied"));
    if (iconEl) {
      iconEl.setAttribute("data-lucide", "check");
      iconEl.classList.add("message-edit-icon-copied");
      lucide.createIcons();
      setTimeout(() => {
        iconEl.setAttribute("data-lucide", "copy");
        iconEl.classList.remove("message-edit-icon-copied");
        lucide.createIcons();
      }, 3000);
    }
  };

  copyToClipboard(message.content, showCopied);
}

async function regenerateFromUserMessage(messageId) {
  const session = getCurrentSession();
  if (!session || state.isSending) {
    return;
  }

  const target = session.messages.find((message) => message.id === messageId && message.role === "user");
  if (!target) {
    return;
  }

  if (typeof window.__prepareAutoTtsTurn === "function") {
    window.__prepareAutoTtsTurn();
  }

  state.isSending = true;
  setInlineChatStatus(t("chat.statusProcessing"));
  if (els.thinkingPopover && !els.thinkingPopover.classList.contains("hidden")) {
    els.thinkingPopover.classList.add("hidden");
    els.thinkingPopover.classList.remove("visible");
    els.thinkingToggleBtn?.classList.remove("active");
  }
  els.sendBtn.disabled = true;
  els.chatInput.disabled = true;
  updateComposerMode();
  clearUserMessageEdit();
  applyUserMessageEdit(session, messageId, target.content || "");
  debugLog("turn", t("debug.msg.regenerate"), {
    sessionId: session.id,
    messageId,
    content: target.content || "",
  });
  touchSession(session);
  persistSessions();
  renderMessages();
  renderChatListMenu();
  pinLastUserMessageToTop();
  state.abortController = new AbortController();
  await runSessionTurn(session);
}

function applyUserMessageEdit(session, messageId, content) {
  const targetIndex = session.messages.findIndex((message) => message.id === messageId && message.role === "user");
  if (targetIndex === -1) {
    session.messages.push({
      id: createMessageId("user"),
      role: "user",
      speaker: "你",
      content,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  const target = session.messages[targetIndex];
  target.content = content;
  target.createdAt = new Date().toISOString();

  const removedMsgs = session.messages.slice(targetIndex + 1);
  if (removedMsgs.length && window.__chatDB) {
    removedMsgs.forEach(function (m) {
      if (m.id) window.__chatDB.deleteMessage(m.id).catch(function () {});
    });
  }

  session.messages = session.messages.slice(0, targetIndex + 1);
  session.transientNpcs = [];
  const nextCount = getLoadedMessageBaseSequence(session) + getLoadedNonSystemMessages(session).length;
  session.messageCount = Math.max(0, nextCount);
}
