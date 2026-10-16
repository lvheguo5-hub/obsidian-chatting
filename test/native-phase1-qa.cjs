// Run with Obsidian CLI eval in the isolated test vault. Never use the main vault.
module.exports = async function phase1QA(app, candidate) {
  const fs = require('node:fs');
  const root = app.vault.adapter.getBasePath();
  if (root !== '/Volumes/StudioSSD/Obsidian/ob 插件测试') throw new Error('wrong QA vault');
  const id = 'chatting-with-ai';
  const dir = `${root}/.obsidian/plugins/${id}`;
  let plugin = app.plugins.plugins[id];
  const before = JSON.stringify(plugin.chatHistory);
  const beforeAPI = JSON.stringify(plugin.agent.exportMessages());
  await app.plugins.disablePlugin(id);
  await app[Symbol.for('chatting-with-ai-pending-chat-state-write')];
  for (const name of ['main.js', 'styles.css', 'manifest.json']) fs.copyFileSync(`${candidate}/${name}`, `${dir}/${name}`);
  await app.plugins.enablePlugin(id);
  plugin = app.plugins.plugins[id];
  const checks = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const settle = () => new Promise(r => require('node:timers').setTimeout(r, 150));
  check(JSON.stringify(plugin.chatHistory) === before, 'upgrade-visible-history');
  check(JSON.stringify(plugin.agent.exportMessages()) === beforeAPI, 'upgrade-api-history');
  const view = await plugin.activateView();
  await view.ready;
  const chat = view.chatContainer;
  const history = structuredClone(plugin.chatHistory);
  const settings = { ...plugin.settings };
  const save = plugin.saveSettings;
  const report = { scope: 'native desktop Obsidian; mobile checks are emulation only', checks };
  try {
    // Synthetic catalog and settings handlers never write real credentials.
    plugin.saveSettings = async () => {};
    const tab = app.setting.pluginTabs.find(t => t.plugin === plugin);
    tab.catalogModels = [{ value: settings.model, label: 'QA model', reasoningEfforts: ['low', 'high'] }];
    const host = tab.containerEl;
    tab.apiKeyEditing = true;
    try {
      tab.display();
      const dropdown = [...host.querySelectorAll('select')].find(el => [...el.options].some(o => o.value === 'high'));
      check(!!dropdown && [...dropdown.options].some(o => o.value === 'high'), 'native-thinking-dropdown');
      dropdown.value = 'high'; dropdown.dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
      check(plugin.settings.thinkingLevel === 'high', 'native-thinking-change');
    } finally { host.empty(); tab.catalogModels = undefined; tab.apiKeyEditing = false; }
    chat.clearMessages();
    chat.addUserMessage('Native phase 1 QA');
    chat.addAssistantMessage('Inline \\(x^2\\)\n\n```math\ny=x+1\n```');
    await settle();
    await settle();
    check(view.contentEl.querySelectorAll('.math').length >= 2, 'native-inline-and-display-math');
    const step = chat.addToolCall('edit_document', { path: 'QA/Phase1.md', operation: 'find_replace', find: 'a', content: 'b' });
    await settle();
    check(view.contentEl.textContent.includes('Editing Phase1'), 'native-running-tool-label');
    chat.updateToolResult(step, 'edit_document', { result: 'QA tool result', isError: false });
    await settle();
    const tool = view.contentEl.querySelector('.ochatting-tool');
    check(tool.textContent.includes('Edited Phase1'), 'native-completed-tool-label');
    tool.querySelector('summary').click();
    check(tool.open && tool.textContent.includes('QA tool result'), 'native-tool-details');
    const failure = chat.addToolCall('read_file', { path: 'missing.md' });
    chat.updateToolResult(failure, 'read_file', { result: 'Not found', isError: true });
    await settle();
    check(!!view.contentEl.querySelector('.ochatting-tool.is-error'), 'native-tool-error');
    for (let i = 0; i < 35; i++) chat.addAssistantMessage(`QA scroll ${i}\n\n${'Long answer text. '.repeat(12)}`);
    await settle();
    const scroll = view.contentEl.querySelector('.ochatting-messages');
    check(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 35, 'native-follow-bottom');
    scroll.scrollTop = Math.max(0, scroll.scrollTop - 400);
    scroll.dispatchEvent(new Event('scroll'));
    const position = scroll.scrollTop;
    chat.addAssistantMessage('QA late answer');
    await settle();
    check(Math.abs(scroll.scrollTop - position) < 3, 'native-reading-position-preserved');
    const jump = view.contentEl.querySelector('.ochatting-jump-btn');
    check(!!jump, 'native-jump-button');
    jump.click(); await settle();
    check(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 35, 'native-jump-to-latest');
    const input = view.contentEl.querySelector('textarea');
    input.value = '日本語'; input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    await settle();
    check(input.value === '日本語' && JSON.stringify(plugin.chatHistory) === before, 'native-ime-confirmation-keeps-draft');
    const rect = input.getBoundingClientRect();
    check(rect.height > 0 && rect.bottom <= view.contentEl.getBoundingClientRect().bottom + 1, 'native-input-visible');
    report.layout = { panelWidth: view.contentEl.clientWidth, inputHeight: rect.height };
    return report;
  } finally {
    plugin.settings = settings;
    Object.assign(plugin.agent.settings, settings);
    plugin.saveSettings = save;
    plugin.chatHistory = history;
    // Discard synthetic UI messages, reconstruct from the untouched real history.
    await view.leaf.detach();
    await plugin.activateView();
  }
};
