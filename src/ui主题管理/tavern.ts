import { waitUntil } from 'async-wait-until';
import { Theme } from './theme';

/** 酒馆 `POST /api/settings/get` 的响应中我们只关心 `themes` */
const SettingsResponse = z.looseObject({
  themes: z.array(z.unknown()).default([]),
});

/**
 * 从酒馆服务器拉取全部主题.
 *
 * 该接口会连带返回预设等数据, 响应可能有上百 MB (实测 328 个主题时为 113 MB),
 * 因此调用方应缓存结果, 不要反复请求.
 *
 * 单个主题若不符合 schema 会被跳过而非中断整体读取, 以免一个坏主题导致全部无法显示.
 */
export async function fetchThemes(): Promise<Theme[]> {
  const response = await fetch('/api/settings/get', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw Error(`读取酒馆设置失败: HTTP ${response.status}`);
  }

  const settings = SettingsResponse.parse(await response.json());

  const themes: Theme[] = [];
  for (const raw of settings.themes) {
    const parsed = Theme.safeParse(raw);
    if (parsed.success) {
      themes.push(parsed.data);
    } else {
      console.warn(`[UI主题管理] 跳过无法解析的主题:\n${z.prettifyError(parsed.error)}`);
    }
  }
  console.info(`[UI主题管理] 已读取 ${themes.length} 个主题`);
  return themes;
}

/** 当前酒馆正在使用的主题名 */
export function getCurrentThemeName(): string | undefined {
  return SillyTavern.powerUserSettings?.theme;
}

/**
 * 切换酒馆的 UI 主题.
 *
 * 走酒馆自己的 `#themes` 下拉框 change 事件, 而不是自己去改 `powerUserSettings`:
 * 主题包含 39 个字段, 每个字段都有对应的 apply 函数 (改 body 类名、CSS 变量、注入
 * custom_css 等), 自行复现极易漏掉, 交给酒馆处理最可靠.
 */
export function applyTheme(name: string): void {
  const $select = $('#themes');
  if ($select.length === 0) {
    throw Error('找不到酒馆的主题下拉框 #themes');
  }
  if ($select.find(`option[value="${CSS.escape(name)}"]`).length === 0) {
    throw Error(`酒馆的主题列表中没有 '${name}'`);
  }
  $select.val(name).trigger('change');
  console.info(`[UI主题管理] 已切换主题: ${name}`);
}

/**
 * 导入主题并同步到酒馆.
 *
 * 把文件交给酒馆自己的导入控件 (`#ui_preset_import_file`) 而不是自行调用
 * `/api/themes/save`: 酒馆的 `applyTheme` 只从 `power-user.js` 的模块级 `themes`
 * 数组里查主题, 而那个数组不对外暴露. 自行保存虽然能让下拉框出现名字, 但选中时
 * `applyTheme` 查不到数据会直接 return, 主题看起来能选却毫无效果.
 *
 * 走原生控件还顺带获得酒馆的字段规范化与 `@import` 安全确认.
 *
 * @param file 主题文件 (酒馆导出的主题 json)
 * @returns 导入后的主题
 */
export async function importTheme(file: File): Promise<Theme> {
  // 自己也解析一次, 用于加进本面板的列表
  const parsed = Theme.safeParse(JSON.parse(await file.text()));
  if (!parsed.success) {
    throw Error(`主题文件格式不正确:\n${z.prettifyError(parsed.error)}`);
  }
  const theme = parsed.data;

  const exists = () => $(`#themes option[value="${CSS.escape(theme.name)}"]`).length > 0;
  if (exists()) {
    throw Error(`酒馆里已有同名主题 '${theme.name}'`);
  }

  const input = $('#ui_preset_import_file')[0] as HTMLInputElement | undefined;
  if (input === undefined) {
    throw Error('找不到酒馆的主题导入控件, 请改用「用户设置」面板里的导入按钮');
  }

  // DataTransfer 必须来自酒馆页面, 否则跨 realm 的 FileList 无法赋值给它的 input
  const tavern_window = input.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (tavern_window === null) {
    throw Error('无法访问酒馆页面');
  }
  const transfer = new tavern_window.DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  $(input).trigger('change');

  // 酒馆的导入是异步的, 等它把新主题加进下拉框
  try {
    await waitUntil(exists, { timeout: 15_000, intervalBetweenAttempts: 100 });
  } catch {
    throw Error('酒馆没有接受这个主题, 具体原因见酒馆自己的报错提示');
  }

  console.info(`[UI主题管理] 已导入主题: ${theme.name}`);
  return theme;
}
