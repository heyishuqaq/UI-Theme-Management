/**
 * 酒馆 UI 主题的数据结构与读取.
 *
 * 酒馆并未把主题数据挂在任何全局变量上 (`window.themes` 其实是 `<select>` 元素),
 * 唯一来源是 `POST /api/settings/get`. 该接口会连带返回预设等大量数据 (实测上百 MB),
 * 因此必须只拉取一次并缓存, 不能反复请求.
 */

/** 酒馆 `avatar_style` 的取值, 对应 body 上的头像形状类名 */
const AVATAR_STYLE = { ROUNDED: 0, RECTANGULAR: 1, SQUARE: 2 } as const;

/** 酒馆 `chat_display` 的取值, 对应 body 上的聊天布局类名 */
const CHAT_DISPLAY = { DEFAULT: 0, BUBBLES: 1, DOCUMENT: 2 } as const;

/*
 * 实际的主题文件里字段既不完整也不干净: 老版本酒馆存下的主题会缺字段, 用户手改过的
 * 主题常把布尔字段写成空字符串 (本机 328 个主题里 4 个缺字段、5 个字段有类型问题).
 * 因此每个字段都「缺失或类型不符时回退默认值」, 避免一个坏字段让整个主题无法显示.
 */

function looseString(fallback: string) {
  return z
    .unknown()
    .optional()
    .transform(value => (typeof value === 'string' ? value : fallback));
}

function looseNumber(fallback: number) {
  return z
    .unknown()
    .optional()
    .transform(value => (typeof value === 'number' && Number.isFinite(value) ? value : fallback));
}

function looseBoolean(fallback: boolean) {
  return z
    .unknown()
    .optional()
    .transform(value => (typeof value === 'boolean' ? value : fallback));
}

/**
 * 主题字段. 不同酒馆版本的字段数量会变化, 因此用 `looseObject` 保留未知字段,
 * 以免导出主题时丢失内容.
 */
export const Theme = z.looseObject({
  name: z.string(),

  // 颜色
  main_text_color: looseString('rgba(220, 220, 210, 1)'),
  italics_text_color: looseString('rgba(145, 145, 145, 1)'),
  underline_text_color: looseString('rgba(188, 231, 207, 1)'),
  quote_text_color: looseString('rgba(225, 138, 36, 1)'),
  blur_tint_color: looseString('rgba(23, 23, 23, 1)'),
  chat_tint_color: looseString('rgba(23, 23, 23, 1)'),
  user_mes_blur_tint_color: looseString('rgba(0, 0, 0, 0.9)'),
  bot_mes_blur_tint_color: looseString('rgba(0, 0, 0, 0.9)'),
  shadow_color: looseString('rgba(0, 0, 0, 1)'),
  border_color: looseString('rgba(0, 0, 0, 1)'),

  // 数值
  blur_strength: looseNumber(10),
  shadow_width: looseNumber(2),
  font_scale: looseNumber(1),
  chat_width: looseNumber(50),

  // 布局枚举
  avatar_style: looseNumber(AVATAR_STYLE.ROUNDED),
  chat_display: looseNumber(CHAT_DISPLAY.DEFAULT),

  // 开关
  fast_ui_mode: looseBoolean(true),
  waifuMode: looseBoolean(false),
  noShadows: looseBoolean(false),
  reduced_motion: looseBoolean(false),
  hotswap_enabled: looseBoolean(true),
  timer_enabled: looseBoolean(true),
  timestamps_enabled: looseBoolean(true),
  timestamp_model_icon: looseBoolean(false),
  message_token_count_enabled: looseBoolean(false),
  mesIDDisplay_enabled: looseBoolean(false),
  hideChatAvatars_enabled: looseBoolean(false),
  expand_message_actions: looseBoolean(false),
  show_swipe_num_all_messages: looseBoolean(false),

  // 自定义 CSS, 主题的主要差异往往都在这里
  custom_css: looseString(''),
});
export type Theme = z.output<typeof Theme>;

/**
 * 把主题的开关字段翻译成酒馆 `<body>` 上的类名.
 *
 * 这些映射来自酒馆 `/scripts/power-user.js` 中的 `applyPowerUserSettings` 系列函数,
 * 预览时必须复现, 否则气泡布局、头像形状等都会回落到默认值.
 */
export function getThemeBodyClasses(theme: Theme): string {
  const classes: string[] = [];

  if (theme.fast_ui_mode) classes.push('no-blur');
  if (theme.waifuMode) classes.push('waifuMode');
  if (theme.noShadows) classes.push('noShadows');

  switch (theme.avatar_style) {
    case AVATAR_STYLE.RECTANGULAR:
      classes.push('big-avatars');
      break;
    case AVATAR_STYLE.SQUARE:
      classes.push('square-avatars');
      break;
    default:
      classes.push('rounded-avatars');
  }

  switch (theme.chat_display) {
    case CHAT_DISPLAY.BUBBLES:
      classes.push('bubblechat');
      break;
    case CHAT_DISPLAY.DOCUMENT:
      classes.push('documentstyle');
      break;
  }

  if (theme.reduced_motion) classes.push('reduced-motion', 'no_animation');
  if (theme.hideChatAvatars_enabled) classes.push('hideChatAvatars');
  if (theme.expand_message_actions) classes.push('expandMessageActions');
  if (theme.show_swipe_num_all_messages) classes.push('swipeAllMessages');

  // 以下几个是「关闭时才加类名」, 注意取反
  if (!theme.hotswap_enabled) classes.push('no-hotswap');
  if (!theme.timer_enabled) classes.push('no-timer');
  if (!theme.timestamps_enabled) classes.push('no-timestamps');
  if (!theme.timestamp_model_icon) classes.push('no-modelIcons');
  if (!theme.message_token_count_enabled) classes.push('no-tokenCount');
  if (!theme.mesIDDisplay_enabled) classes.push('no-mesIDDisplay');

  return classes.join(' ');
}

/**
 * 把主题的颜色、数值字段翻译成酒馆使用的 CSS 变量.
 *
 * 对应 `/scripts/power-user.js` 中 `applyThemeColor` 等函数所设置的变量.
 */
export function getThemeCssVariables(theme: Theme): string {
  // 酒馆会把正文色拆成 RGBA 四个分量供复选框使用
  const [r, g, b, a] = theme.main_text_color.match(/[\d.]+/g) ?? [];

  const variables: Record<string, string | number | undefined> = {
    '--SmartThemeBodyColor': theme.main_text_color,
    '--SmartThemeEmColor': theme.italics_text_color,
    '--SmartThemeUnderlineColor': theme.underline_text_color,
    '--SmartThemeQuoteColor': theme.quote_text_color,
    '--SmartThemeBlurTintColor': theme.blur_tint_color,
    '--SmartThemeChatTintColor': theme.chat_tint_color,
    '--SmartThemeUserMesBlurTintColor': theme.user_mes_blur_tint_color,
    '--SmartThemeBotMesBlurTintColor': theme.bot_mes_blur_tint_color,
    '--SmartThemeShadowColor': theme.shadow_color,
    '--SmartThemeBorderColor': theme.border_color,
    '--SmartThemeCheckboxBgColorR': r,
    '--SmartThemeCheckboxBgColorG': g,
    '--SmartThemeCheckboxBgColorB': b,
    '--SmartThemeCheckboxBgColorA': a,
    '--blurStrength': theme.blur_strength,
    '--shadowWidth': theme.shadow_width,
    '--fontScale': theme.font_scale,
    // 预览窗口很窄, 让聊天区填满而不是按原设置留白
    '--sheldWidth': '100vw',
  };

  return Object.entries(variables)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}
