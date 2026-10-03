(() => {
  "use strict";
  const page = document.querySelector("[data-wendao-page]");
  if (!page) return;
  const byId = (id) => document.getElementById(id);
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  let state = {},
    busy = false,
    polling = null, refreshing = false;
  let savingPrivacy = false;
  let privacyEnabled = true, privacyRevision = 0;
  function renderPrivacy(enabled) {
    const toggle = byId('settings-ai-name-privacy-toggle');
    if (!toggle) return;
    privacyEnabled = enabled;
    toggle.checked = enabled;
    toggle.disabled = savingPrivacy;
    byId('ai-name-privacy-status').textContent = enabled ? '已开启' : '已关闭，学生真名将发送给模型';
  }
  const error = (message) => {
    byId("wendao-error").textContent = message || "";
    byId("wendao-error").hidden = !message;
  };
  async function api(path, body) {
    const response = await fetch("/api/wendao/" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("本地服务返回了无效响应，请刷新页面。");
    }
    if (!response.ok || data.status === "error")
      throw new Error(data.message || "请求失败，请重试。");
    return data;
  }
  function money(value) {
    return (
      (Number(value || 0) / 1e9).toLocaleString("zh-CN", {
        maximumFractionDigits: 6,
      }) + " USD"
    );
  }
  function date(value) {
    return value ? new Date(value).toLocaleString("zh-CN") : "";
  }
  function quota(data) {
    const box = byId("quota");
    box.replaceChildren();
    byId("quota-note").hidden = !data;
    if (!data) return;
    const add = (title, amount, note) => {
      const item = document.createElement("article"),
        h = document.createElement("h2"),
        value = document.createElement("strong"),
        p = document.createElement("p");
      h.textContent = title;
      value.textContent = amount;
      p.textContent = note;
      item.append(h, value, p);
      box.append(item);
    };
    if (data.balance?.amount_nanousd != null)
      add(
        "账户余额",
        money(data.balance.amount_nanousd),
        data.balance.status === "active"
          ? "账户正常"
          : "账户状态：" + data.balance.status,
      );
    for (const [key, title] of [
      ["period", "周期剩余额度"],
      ["sliding_window", "窗口剩余额度"],
    ]) {
      const item = data[key];
      if (item)
        add(
          title,
          item.remaining_nanousd == null ? "剩余 " + (100 - Math.round(Math.max(0, Math.min(100, Number(item.usage_percent || 0))))) + "%" : money(item.remaining_nanousd),
          (item.limit_nanousd == null ? "已使用 " + Math.round(Math.max(0, Math.min(100, Number(item.usage_percent || 0)))) + "%" : "已用 " +
            money(item.used_nanousd) +
            " / " +
            money(item.limit_nanousd)) +
            (item.reset_at
              ? " · 重置于 " + date(item.reset_at)
              : " · 下次调用开始计时"),
        );
    }
    if (data.mode === "self")
      add("本站计费", "不按本站额度计费", "模型权限和线路可用性仍适用");
    byId("quota-note").textContent =
      "更新于 " +
      date(data.as_of) +
      "。仅含已结算消耗，不包含进行中和待结算用量。";
  }
  function setBusy(value) {
    busy=value;
    byId("model-select").disabled=busy || !state.connected || state.reauthorize;
  }
  async function refresh(loadModels = false) {
    if (refreshing) return;
    refreshing=true;
    const revision = privacyRevision;
    try {
      state = await api("status/");
      if (!savingPrivacy && revision === privacyRevision) renderPrivacy(state.name_privacy_enabled !== false);
      byId("connection-status").textContent = state.pending
        ? "等待浏览器完成授权…"
        : state.reauthorize
          ? "需要重新授权"
          : state.connected
            ? "已连接闻道智能" +
              (state.expires_at
                ? " · 授权到期 " + date(state.expires_at)
                : " · 长期有效")
            : "尚未连接闻道智能";
      quota(state.usage);
      error(state.error);
      if (byId("connect")) {
        byId("connect").textContent = state.connected
          ? "重新授权"
          : "连接闻道智能";
        byId("disconnect").hidden = !state.connected && !state.pending;
        byId("disconnect").textContent = state.connected
          ? "解除授权"
          : "取消连接";
      }
      if (polling && !state.pending) {
        clearInterval(polling);
        polling = null;
        byId("authorize-again").hidden = true;
        loadModels = true;
        byId("connection-hint").textContent =
          state.authorization_status === "completed"
            ? "连接已完成，模型已自动读取。"
            : "本次授权未完成或已过期，可重新连接。原有连接不会被覆盖。";
      }
      if (
        loadModels &&
        byId("model-select") &&
        state.connected &&
        !state.reauthorize
      ) {
        const result = await api("models/"),
          select = byId("model-select");
        select.replaceChildren(new Option("请选择模型", ""));
        result.models.forEach((model) => select.add(new Option(model, model)));
        select.value = state.model;
        if (!result.models.includes(state.model)) {
          state.model = "";
          if (result.models.length) state.model=(await api("model/", {model:result.models[0]})).model;
          select.value=state.model;
        }
        if (!result.models.length)
          error("当前账户没有可用模型，请在闻道智能检查模型权限。");
      }
      if (!state.connected || state.reauthorize) { byId("model-select").replaceChildren(new Option("连接后自动读取模型","")); state.model=""; }
      setBusy(busy);
    } catch (exc) {
      error(exc.message);
    } finally { refreshing=false; }
  }
  byId("refresh").addEventListener("click", () => refresh(true));
  byId("connect")?.addEventListener("click", async () => {
    const button = byId("connect");
    button.disabled = true;
    error("");
    // Open synchronously to preserve the browser's user gesture.
    const desktop = document.body.dataset.appShell === "webview";
    const tab = desktop ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const data = await api("connect/", {classroom: page.dataset.classroom || null});
      byId("authorize-again").href = data.authorize_url;
      byId("authorize-again").hidden = false;
      if (desktop)
        await window.CloudManager.openExternalUrl(data.authorize_url);
      else if (tab) tab.location.replace(data.authorize_url);
      else
        byId("connection-hint").textContent =
          "浏览器阻止了弹窗，请点击“再次打开授权页面”。";
      if (polling) clearInterval(polling);
      let checking = false;
      polling = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          await refresh();
        } finally {
          checking = false;
        }
      }, 2500);
      await refresh();
    } catch (exc) {
      if (tab) tab.close();
      error(exc.message);
    } finally {
      button.disabled = false;
    }
  });
  byId("disconnect")?.addEventListener("click", async () => {
    if (
      !window.confirm(
        "解除后，本机将无法继续使用此授权调用闻道智能。是否继续？",
      )
    )
      return;
    try {
      await api("disconnect/", {});
      await refresh();
    } catch (exc) {
      error(exc.message);
    }
  });
  byId("model-select")?.addEventListener("change", async (event) => {
    setBusy(true);
    try {
      const data = await api("model/", { model: event.target.value });
      state.model = data.model;
      error("");
    } catch (exc) {
      event.target.value = state.model || "";
      error(exc.message);
    }
    setBusy(false);
  });

  byId('settings-ai-name-privacy-toggle')?.addEventListener('change', async (event) => {
    const previous = privacyEnabled;
    let next = previous;
    privacyRevision += 1;
    savingPrivacy = true;
    event.target.disabled = true;
    byId('ai-name-privacy-status').textContent = '正在保存…';
    try {
      const result = await api('privacy/', {enabled: event.target.checked});
      next = result.name_privacy_enabled;
      error('');
    } catch (exc) {
      error(exc.message);
    } finally {
      savingPrivacy = false;
      renderPrivacy(next);
    }
  });

  document.addEventListener('visibilitychange',()=>{if(!document.hidden) refresh(true);});
  window.addEventListener('focus',()=>refresh(true));
  window.addEventListener('pagehide',()=>{if(polling) clearInterval(polling);});
  refresh(true);
})();
