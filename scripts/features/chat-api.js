function resolveModelConfig(configId, model, fallbackConfigId = "") {
  const configs = state.settings.configs || [];
  const directMatch = configs.find((config) => config.id === configId && config.host && config.key);
  if (directMatch) {
    return directMatch;
  }

  const byModel = configs.find((config) =>
    config.host && config.key && Array.isArray(config.workModels) && config.workModels.includes(model)
  );
  if (byModel) {
    return byModel;
  }

  const fallback = configs.find((config) => config.id === fallbackConfigId && config.host && config.key);
  if (fallback) {
    return fallback;
  }

  throw new Error(`未找到模型 ${model} 对应的接口配置`);
}

function findLatestAssistantMessage(session, speaker) {
  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const item = session.messages[i];
    if (item.role === "assistant" && item.speaker === speaker && (item.pending || item.streaming || !item.content)) {
      return item;
    }
  }
  return null;
}

function normalizeUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") {
    return null;
  }

  const input = Number(rawUsage.prompt_tokens ?? rawUsage.input_tokens ?? rawUsage.input ?? 0) || 0;
  const output = Number(rawUsage.completion_tokens ?? rawUsage.output_tokens ?? rawUsage.output ?? 0) || 0;
  const total = Number(rawUsage.total_tokens ?? input + output) || 0;
  if (!input && !output && !total) {
    return null;
  }

  return { input, output, total };
}

function estimateTokens(text) {
  const source = String(text || "");
  if (!source.trim()) {
    return 0;
  }

  const cjkMatches = source.match(/[㐀-鿿豈-﫿]/g) || [];
  const asciiWordMatches = source.match(/[A-Za-z0-9_]+/g) || [];
  const asciiWordChars = asciiWordMatches.reduce((sum, chunk) => sum + chunk.length, 0);
  const punctuationChars = (source.match(/[^\sA-Za-z0-9_㐀-鿿豈-﫿]/g) || []).length;
  const whitespaceChars = (source.match(/\s/g) || []).length;
  const otherChars = Math.max(0, source.length - cjkMatches.length - asciiWordChars - punctuationChars - whitespaceChars);

  return Math.max(
    1,
    Math.round(
      cjkMatches.length * 0.85 +
      asciiWordChars / 3.6 +
      punctuationChars * 0.35 +
      otherChars * 0.7
    )
  );
}

function estimateChatMessagesTokens(messages) {
  if (!Array.isArray(messages) || !messages.length) {
    return 0;
  }

  let total = 0;
  messages.forEach((message) => {
    total += 4;
    total += estimateTokens(message?.role || "");
    total += estimateTokens(message?.name || "");
    total += estimateTokens(message?.content || "");
  });

  return Math.max(1, total + 2);
}

function estimateMessageOutputUsage(message) {
  if (!message || message.role !== "assistant" || message.pending) {
    return null;
  }

  const output = estimateTokens([message.content || "", message.thinking || ""].filter(Boolean).join("\n"));
  if (!output) {
    return null;
  }
  return { input: 0, output, total: output };
}

function buildMessageTokenLabel(message) {
  if (state.settings?.session?.showTokenDisplay === false) {
    return "";
  }
  const usage = normalizeUsage(message?.usage);
  const estimatedUsage = normalizeUsage(message?.estimatedUsage) || estimateMessageOutputUsage(message);
  const tokenStats = usage || estimatedUsage;
  if (!tokenStats) {
    return "";
  }
  const prefix = usage ? "" : "~";

  if (tokenStats.input && tokenStats.output) {
    return `${prefix}${tokenStats.input} in · ${prefix}${tokenStats.output} out`;
  }
  if (tokenStats.output && !tokenStats.input) {
    return `${prefix}${tokenStats.output} out`;
  }
  if (tokenStats.total) {
    return `${prefix}${tokenStats.total} total`;
  }
  if (tokenStats.input) {
    return `${prefix}${tokenStats.input} in`;
  }
  return `${prefix}${tokenStats.output} out`;
}

function supportsThinkingParam(modelName) {
  const name = (modelName || "").toLowerCase();
  // nothinking 系列模型明确不支持 thinking 参数
  if (name.includes("nothinking")) return false;
  return name.includes("deepseek") || name.includes("claude") || name.includes("doubao") || name.includes("chatgpt");
}

function buildThinkingExtra(modelName, value) {
  if (!supportsThinkingParam(modelName)) return {};
  // value can be boolean (director: true/false) or string (model: "auto"/"enabled"/"disabled")
  let type = "disabled";
  if (value === true || value === "enabled") type = "enabled";
  else if (value === "auto") type = "auto";
  return { thinking: { type } };
}

async function createChatCompletion(host, key, model, messages, stream = false, temperature = 0.7) {
  const payload = await createChatCompletionPayload(host, key, model, messages, stream, temperature);
  return payload.content;
}

async function createChatCompletionPayload(host, key, model, messages, stream = false, temperature = 0.7, extraBody = {}) {
  const doPayloadFetch = (withTemp) => fetch(`${host}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      ...(withTemp ? { temperature, stream } : { stream }),
      ...extraBody,
    }),
  });

  let response = await doPayloadFetch(true);
  let detail = "";

  if (!response.ok) {
    detail = await safeReadError(response);
    if (/temperature|unsupported param|not support/i.test(detail)) {
      console.warn("[MOYU] temperature not supported, retrying without it", { model, detail });
      response = await doPayloadFetch(false);
      detail = "";
    }
  }

  if (!response.ok) {
    if (!detail) {
      detail = await safeReadError(response);
    }
    console.error("[MOYU] Create chat completion failed", {
      model,
      status: response.status,
      detail,
      host,
      stream,
    });
    throw new Error(`模型 ${model} 调用失败：HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  return {
    content,
    usage: data?.usage || null,
  };
}

async function readChatCompletionResponse(response, model) {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  const thinking = data?.choices?.[0]?.message?.reasoning_content ?? "";
  return {
    content,
    thinking,
    usage: data?.usage || null,
  };
}

async function readChatCompletionPayload(response, model) {
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`模型 ${model} 没有返回有效内容`);
  }
  const thinking = data?.choices?.[0]?.message?.reasoning_content ?? "";
  return {
    content,
    thinking,
    usage: data?.usage || null,
  };
}

async function streamLocalText(message, content) {
  const text = message?.uiType === "narration" ? sanitizeNarrationText(content) : content.trim();
  if (!text) {
    message.streaming = false;
    message.content = "";
    renderMessages({ stickToBottom: true });
    return;
  }

  const step = Math.max(2, Math.min(12, Math.floor(text.length / 24) || 2));
  for (let index = 0; index < text.length; index += step) {
    if (state.abortController?.signal.aborted) break;
    message.content = text.slice(0, index + step);
    renderMessages({ stickToBottom: true });
    await wait(28);
  }
  message.content = text;
  message.streaming = false;
  renderMessages({ stickToBottom: true });
}
