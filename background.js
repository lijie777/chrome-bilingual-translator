// 后台：图标弹窗、快捷键、右键菜单三种触发方式都走 toggle(tabId)
const MENU_ID = 'xt-toggle';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '翻译此页 / 显示原文',
    contexts: ['page', 'selection', 'link', 'image'],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab) toggle(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translate' && tab) toggle(tab.id);
});

// 弹窗发来的请求，返回出错信息（null 表示成功）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'toggle') return;
  toggle(msg.tabId).then(sendResponse);
  return true;
});

// 按需注入内容脚本（重复注入会被脚本自己忽略），然后切换翻译状态
async function toggle(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__xtToggle() });
    return null;
  } catch (e) {
    console.warn('无法翻译此页面：', e.message);
    return e.message;
  }
}
