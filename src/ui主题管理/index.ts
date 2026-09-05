import { createScriptIdDiv, createScriptIdIframe, teleportStyle } from '@util/script';
import type { Pinia } from 'pinia';
import SettingsDrawer from './SettingsDrawer.vue';
import { useThemeStore } from './store';
import ThemePanel from './ThemePanel.vue';

/**
 * UI 主题管理.
 *
 * 酒馆的主题下拉框只给名字, 主题多起来就只能一个个点开试. 本脚本把每个主题渲染成
 * 一张缩略图卡片 (真实酒馆 DOM + 该主题样式), 让用户一屏扫过去就能挑.
 *
 * 入口在扩展设置抽屉里, 点开为全屏面板.
 */

const OVERLAY_CLASS = 'ui-theme-manager-overlay';

/**
 * 全屏面板的尺寸与层级.
 *
 * 必须写成带 `!important` 的样式规则而不是内联样式: 酒馆助手的 iframe 模板里带一段
 * 自动高度脚本, 它会把 iframe 的 `style.height` 改成内容高度 (面板有几百张卡片时会
 * 变成几万像素). 样式表里的 `!important` 优先级高于 JS 写的内联样式, 因此能压住它.
 */
const OVERLAY_STYLE = `
  iframe.${OVERLAY_CLASS} {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    border: none !important;
    z-index: 10000 !important;
  }`;

/** 面板内部需要撑满 iframe, 而酒馆助手的 iframe 模板没有给 html/body 设高度 */
const PANEL_ROOT_STYLE = `
  html, body {
    height: 100% !important;
    overflow: hidden !important;
  }`;

/**
 * 创建全屏面板.
 *
 * 面板挂在 iframe 内以隔离样式: 酒馆各主题的 custom_css 往往会大范围改写选择器,
 * 直接挂在酒馆页面上会让面板自己的样式失控.
 */
function createPanel(pinia: Pinia): { open: () => void; destroy: () => void } {
  let $overlay: JQuery<HTMLIFrameElement> | undefined;
  let app: ReturnType<typeof createApp> | undefined;

  function close(): void {
    app?.unmount();
    app = undefined;
    $overlay?.remove();
    $overlay = undefined;
  }

  function open(): void {
    if ($overlay !== undefined) {
      return;
    }

    // 与抽屉共用同一个 pinia, 面板重开时不必重新拉取主题数据
    app = createApp(ThemePanel, { onClose: () => close() }).use(pinia);

    $overlay = createScriptIdIframe()
      .addClass(OVERLAY_CLASS)
      .on('load', function () {
        const iframe_document = (this as HTMLIFrameElement).contentDocument!;
        $('<style>').text(PANEL_ROOT_STYLE).appendTo(iframe_document.head);
        teleportStyle(iframe_document.head);
        app!.mount(iframe_document.body);
      })
      .appendTo('body') as JQuery<HTMLIFrameElement>;
  }

  return { open, destroy: close };
}

/** 脚本库里的按钮名. 扩展抽屉之外多给一个入口, 免得在几十个扩展里翻找. */
const BUTTON_NAME = 'UI 主题';

function init(): void {
  const pinia = createPinia();
  const panel = createPanel(pinia);

  const $overlay_style = $('<style>').text(OVERLAY_STYLE).appendTo('head');

  // 抽屉挂在酒馆原生 DOM 上, 需要 teleportStyle 才能让脚本里的样式生效
  const drawer_app = createApp(SettingsDrawer, { onOpen: () => panel.open() }).use(pinia);
  const $drawer = createScriptIdDiv().appendTo('#extensions_settings2');
  drawer_app.mount($drawer[0]);
  const { destroy: destroy_drawer_style } = teleportStyle();

  appendInexistentScriptButtons([{ name: BUTTON_NAME, visible: true }]);
  eventOn(getButtonEvent(BUTTON_NAME), () => panel.open());

  // 用户在酒馆的用户设置面板里换了主题时, 面板里的「当前」标记要跟着变
  const store = useThemeStore(pinia);
  eventOn(tavern_events.SETTINGS_UPDATED, () => store.syncCurrentFromTavern());

  $(window).on('pagehide', () => {
    panel.destroy();
    drawer_app.unmount();
    $drawer.remove();
    destroy_drawer_style();
    $overlay_style.remove();
  });

  console.info(`[UI主题管理] 已加载. 入口: 扩展设置面板的「UI 主题管理」抽屉, 或脚本库里的「${BUTTON_NAME}」按钮`);
}

$(() => {
  errorCatched(init)();
});
