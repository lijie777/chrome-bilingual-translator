// 弹窗：选择目标语言（存到 storage.sync），点按钮翻译当前页
const LANGS = ['zh', 'zh-Hant', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'ru'];
const names = new Intl.DisplayNames(['zh-CN'], { type: 'language' });

const select = document.getElementById('target');
const button = document.getElementById('toggle');
const tip = document.getElementById('tip');

for (const code of LANGS) select.add(new Option(names.of(code), code));

chrome.storage.sync.get('target').then(({ target = 'zh' }) => { select.value = target; });
select.addEventListener('change', () => chrome.storage.sync.set({ target: select.value }));

if (!('Translator' in self)) showError('当前浏览器不支持内置翻译，需要电脑版 Chrome 138 或更新版本。');

button.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const error = await chrome.runtime.sendMessage({ type: 'toggle', tabId: tab.id });
  if (error) showError('这个页面不能翻译（例如 Chrome 设置页、扩展商店页）。');
  else window.close();
});

function showError(msg) {
  tip.textContent = msg;
  tip.classList.add('error');
}
