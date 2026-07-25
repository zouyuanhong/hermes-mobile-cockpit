(() => {
  const sdk = window.__HERMES_PLUGIN_SDK__;
  const plugins = window.__HERMES_PLUGINS__;
  if (!sdk || !plugins) return;
  const { React, hooks } = sdk;
  const { useCallback, useEffect, useState } = hooks;
  const h = React.createElement;

  async function gatewayRequest(method, params) {
    const socket = new WebSocket(await sdk.buildWsUrl("/api/ws"));
    const id = `mobile-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { socket.close(); reject(new Error("Hermes request timed out")); }, 15000);
      socket.onopen = () => socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      socket.onmessage = event => {
        const frame = JSON.parse(event.data);
        if (frame.id !== id) return;
        clearTimeout(timeout); socket.close();
        if (frame.error) reject(new Error(frame.error.message || "Hermes rejected the request"));
        else resolve(frame.result);
      };
      socket.onerror = () => { clearTimeout(timeout); reject(new Error("Hermes Gateway connection failed")); };
    });
  }

  function Cockpit() {
    const [tasks, setTasks] = useState([]);
    const [runtime, setRuntime] = useState({ platforms: {} });
    const [text, setText] = useState("");
    const [status, setStatus] = useState("正在读取本机状态…");
    const refresh = useCallback(async () => {
      try {
        const [taskData, runtimeData] = await Promise.all([
          sdk.fetchJSON("/api/plugins/hermes-mobile-cockpit/webllm/tasks"),
          sdk.fetchJSON("/api/plugins/hermes-mobile-cockpit/webllm/runtime")
        ]);
        setTasks(taskData.tasks || []); setRuntime(runtimeData || { platforms: {} });
        setStatus(taskData.source_status === "ready" ? "监听已刷新（数据库只读）" : "Hermes 持久状态暂不可用");
      } catch (error) { setStatus(error.message || "状态读取失败"); }
    }, []);
    useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 3000); return () => clearInterval(timer); }, [refresh]);

    const createTask = async () => {
      if (!text.trim()) return;
      try {
        const created = await gatewayRequest("session.create", {});
        await gatewayRequest("prompt.submit", { session_id: created.session_id, text: text.trim() });
        setText(""); setStatus("已按 Hermes 原生流程创建并提交任务"); void refresh();
      } catch (error) { setStatus(error.message); }
    };
    const stopTask = async sessionId => {
      if (!window.confirm("终止该任务？Hermes 将按原生规则处理中断。")) return;
      try {
        const resumed = await gatewayRequest("session.resume", { session_id: sessionId });
        await gatewayRequest("session.interrupt", { session_id: resumed.session_id });
        setStatus("已请求 Hermes 终止任务"); void refresh();
      } catch (error) { setStatus(error.message); }
    };
    const platformAction = async (name, item, action) => {
      try {
        await sdk.fetchJSON(`/api/plugins/hermes-mobile-cockpit/webllm/platforms/${encodeURIComponent(name)}/actions/${action}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state_version: item.state_version })
        });
        setStatus(`${name}: 已请求 ${action}`); void refresh();
      } catch (error) { setStatus(error.message); }
    };
    const inspectPlatform = async name => {
      try {
        const detail = await sdk.fetchJSON(`/api/plugins/hermes-mobile-cockpit/webllm/platforms/${encodeURIComponent(name)}/inspect`);
        setStatus(`${name}: ${detail.title || detail.url || "页面已检查"}`);
      } catch (error) { setStatus(error.message); }
    };
    return h("main", { className: "mobile-cockpit" },
      h("h1", null, "移动任务驾驶舱"),
      h("p", { className: "muted" }, status),
      h("section", null, h("h2", null, "新建任务"),
        h("textarea", { value: text, onChange: e => setText(e.target.value), placeholder: "交给 Hermes 的任务" }),
        h("button", { onClick: () => void createTask() }, "原生提交")),
      h("section", null, h("h2", null, "Hermes 任务（只读监听）"),
        tasks.map(task => h("article", { key: task.session_id },
          h("strong", null, task.title || task.session_id),
          h("div", null, `${task.phase} · ${task.model || "未记录模型"}`),
          task.phase === "active_unconfirmed" ? h("button", { onClick: () => void stopTask(task.session_id) }, "终止") : null))),
      h("section", null, h("h2", null, "网页 LLM 平台"),
        Object.entries(runtime.platforms || {}).map(([name, item]) => h("article", { key: name },
          h("strong", null, name), h("div", null, item.stage),
          h("div", null,
            h("button", { onClick: () => void platformAction(name, item, "show") }, "显示网页"),
            h("button", { onClick: () => void inspectPlatform(name) }, "检查页面"),
            h("button", { onClick: () => window.open(`/api/plugins/hermes-mobile-cockpit/webllm/platforms/${encodeURIComponent(name)}/screenshot`, "_blank", "noopener") }, "网页截图"),
            h("button", { onClick: () => void platformAction(name, item, "restart") }, "重启")))));
  }

  plugins.register("hermes-mobile-cockpit", Cockpit);
})();
