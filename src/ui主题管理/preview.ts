import { getThemeBodyClasses, getThemeCssVariables, type Theme } from './theme';

/**
 * 生成主题预览用的 iframe srcdoc.
 *
 * 预览的原理: 克隆酒馆自己的消息原型 DOM, 放进独立 iframe, 再引入酒馆自己的
 * 样式表并注入该主题的 CSS 变量与 custom_css. 因为用的是真实 DOM 和真实样式,
 * 缩略图与酒馆里的实际显示高度一致 —— 自己手写一套仿造 DOM 是做不到的.
 *
 * 用 iframe 而非直接插入页面, 是因为几百个主题的 custom_css 会互相覆盖,
 * 也会污染酒馆本身的样式.
 */

/**
 * 预览 iframe 的逻辑尺寸, 实际显示时会被 CSS 缩放.
 *
 * 宽度取 540 而非手机的实际宽度: 卡片是等比缩放的, 逻辑宽度越大, 同一张卡片里就能
 * 容下越多横向内容, 右边也就不会显得挤. 但必须留在 768 以内 —— 酒馆的窄屏样式以此
 * 为断点, 越过去顶栏和输入区就换成电脑版布局, 预览也就不是手机上的样子了.
 */
export const PREVIEW_WIDTH = 540;
export const PREVIEW_HEIGHT = 850;

/**
 * 预览用的背景图: 酒馆背景列表里的第一张, 一张全透明的图.
 *
 * 用它而不是酒馆当前的背景图, 是为了让所有主题在同一底色上对比; 又因为它透明,
 * 主题自己的 `blur_tint_color` 能透上来 —— 半透明主题不会糊在纯白底上看不清.
 */
const PREVIEW_BACKGROUND = 'backgrounds/__transparent.png';

/**
 * 酒馆页面的 document.
 *
 * 脚本运行在 iframe 里, 脚本作用域的 `document` 是 iframe 自己的; 而 `$` 已被替换为
 * 酒馆页面的 jQuery, 所以从它选中的元素上取 `ownerDocument` 才是酒馆页面.
 */
function getTavernDocument(): Document {
  const body = $('body')[0];
  if (body === undefined) {
    throw Error('找不到酒馆页面');
  }
  return body.ownerDocument;
}

/**
 * 收集酒馆自身的样式表地址.
 *
 * 取 DOM 元素的 `href` 属性 (浏览器已解析成绝对地址) 而不是 HTML 里写的相对路径:
 * 预览 iframe 是 srcdoc 形式, 无法用自己的 `location` 解析相对路径.
 *
 * 排除第三方扩展的样式: 它们不属于酒馆原生外观, 且数量多会拖慢预览加载.
 */
function getTavernStylesheetUrls(origin: string): string[] {
  return $('link[rel=stylesheet]')
    .map((_index, element) => (element as HTMLLinkElement).href)
    .get()
    .filter(url => url !== '' && !url.includes('/extensions/') && url.startsWith(origin));
}

/**
 * 第三方扩展往消息里注入的元素, 以及预览里不该出现的交互件.
 *
 * 它们不属于主题外观: 扩展按钮随装了哪些扩展而变, 勾选框和滑动箭头只在交互时有意义.
 */
const MESSAGE_NOISE_SELECTOR = [
  '[class*="blai-"]',
  '[id*="blai-"]',
  '[class*="qra-"]',
  '[class*="te-"]',
  '.favorite-toggle-icon',
  '.for_checkbox',
  'input.del_checkbox',
  '.mes_reasoning_details',
  '.swipe_left',
  '.swipe_right',
  '.swipeRightBlock',
  'script',
  'iframe',
  'video',
  'audio',
].join(', ');

/**
 * 预览里固定显示的那条消息.
 *
 * 内容照抄酒馆自己的 `SillyTavern System` 系统消息: 它由酒馆生成, 与角色卡无关,
 * 所以换角色卡、换聊天时预览都不会跟着变 —— 同一个主题在两次浏览里长得一样才好比较.
 */
const PREVIEW_MESSAGE = {
  name: 'SillyTavern System',
  avatar: 'img/five.png',
  timestamp: '2026年1月1日 00:00',
  text: 'You deleted a character/chat and arrived back here for safety reasons! Pick another character!',
};

/**
 * 克隆一条消息作为预览模板.
 *
 * 取的是酒馆的隐藏原型 `#message_template`: 聊天区里每条消息都由它复制而来, 因此结构
 * 与真实消息完全一致; 而它本身不属于任何一条消息, 也就不会随角色卡或聊天变化.
 *
 * 原型上的名字、头像、正文都是空占位, 由酒馆在复制时填. 这里按系统消息填死, 顺带补上
 * `is_system`、`last_mes` 等属性 —— 主题的 custom_css 常以它们为选择器.
 */
function cloneMessageTemplate(): string | undefined {
  const $message = $('#message_template .mes').first();
  if ($message.length === 0) {
    return undefined;
  }

  const $clone = $message.clone();
  $clone.find(MESSAGE_NOISE_SELECTOR).remove();

  $clone.addClass('last_mes').attr({
    mesid: '0',
    ch_name: PREVIEW_MESSAGE.name,
    is_user: 'false',
    is_system: 'true',
    force_avatar: 'true',
    swipeid: '0',
    timestamp: PREVIEW_MESSAGE.timestamp,
  });
  $clone.find('.avatar img').attr('src', PREVIEW_MESSAGE.avatar);
  $clone.find('.name_text').text(PREVIEW_MESSAGE.name);
  $clone.find('.timestamp').text(PREVIEW_MESSAGE.timestamp);
  $clone.find('.mesIDDisplay').text('#0');
  // 酒馆的正文经 markdown 渲染后是 `<p>` 段落, 主题多按 `.mes_text p` 排版, 这里照做
  $clone.find('.mes_text').empty().append($('<p>').text(PREVIEW_MESSAGE.text));

  return $clone.prop('outerHTML');
}

function getMessageTemplate(): string {
  return cloneMessageTemplate() ?? getFallbackMessageTemplate();
}

/**
 * 兜底模板. 结构照抄酒馆真实的 `SillyTavern System` 消息,
 * 只在酒馆页面里找不到 `#message_template` 原型时使用.
 */
function getFallbackMessageTemplate(): string {
  const { name, avatar, timestamp, text } = PREVIEW_MESSAGE;
  return `
    <div class="mes last_mes" mesid="0" ch_name="${_.escape(name)}" is_user="false" is_system="true"
         force_avatar="true" swipeid="0" timestamp="${_.escape(timestamp)}">
      <div class="mesAvatarWrapper">
        <div class="avatar"><img src="${_.escape(avatar)}"></div>
        <div class="mesIDDisplay">#0</div>
        <div class="mes_timer"></div>
        <div class="tokenCounterDisplay"></div>
      </div>
      <div class="mes_block">
        <div class="ch_name flex-container justifySpaceBetween">
          <div class="flex-container flex1 alignitemscenter">
            <div class="flex-container alignItemsBaseline">
              <span class="name_text">${_.escape(name)}</span>
              <i class="mes_ghost fa-solid fa-ghost"></i>
              <small class="timestamp">${_.escape(timestamp)}</small>
            </div>
          </div>
          <div class="mes_buttons">
            <div class="mes_button extraMesButtonsHint fa-solid fa-ellipsis"></div>
            <div class="mes_button mes_bookmark fa-solid fa-flag"></div>
            <div class="mes_button mes_edit fa-solid fa-pencil"></div>
          </div>
        </div>
        <div class="mes_text"><p>${_.escape(text)}</p></div>
        <div class="mes_media_wrapper"></div>
        <div class="mes_file_wrapper"></div>
        <div class="mes_bias"></div>
      </div>
    </div>`;
}

/**
 * 克隆酒馆顶栏.
 *
 * 顶栏的外观由两个同级元素合成: `#top-bar` 是一个空 div, 只负责铺底色、下边框和阴影;
 * `#top-settings-holder` 装那排图标. 少了前者顶栏就只剩透明底, 与酒馆里看到的不一样,
 * 所以两个都要.
 *
 * 保留 `.drawer` 外层但丢掉 `.drawer-content`: 顶栏的布局由酒馆针对 `.drawer` 的样式
 * 决定, 少了这层图标会挤在一起; 而整个 `#top-settings-holder` 因为含所有设置面板的
 * 内容, 实测近 300 万字符, 不能整体克隆.
 */
function cloneTopBarTemplate(): string {
  const drawers = $('#top-settings-holder > .drawer')
    .map((_index, element) => {
      const $clone = $(element).clone();
      $clone.find('.drawer-content, script, iframe').remove();
      return $clone.prop('outerHTML') as string;
    })
    .get()
    .join('');
  if (drawers === '') {
    return '';
  }
  // `#top-bar` 放进 holder 内当背景层: 它在酒馆里是空元素, 移进来不影响主题的选择器,
  // 却能让底色始终与图标区一样高 —— 图标换行变高时也不会露出半截.
  return `<div id="top-settings-holder"><div id="top-bar"></div>${drawers}</div>`;
}

/**
 * 克隆酒馆输入框区域.
 *
 * 只取 `#nonQRFormItems` (左侧按钮组 + 输入框 + 发送键), 不含快速回复栏 ——
 * 后者属于扩展且体积大, 不影响主题外观判断.
 *
 * 保留原有 id: 预览在独立 iframe 文档里, 不会与酒馆页面的 id 冲突, 而主题的
 * custom_css 常以 `#send_form`、`#send_textarea` 为选择器, 去掉 id 会让预览失真.
 */
function cloneInputAreaTemplate(): string {
  const $items = $('#nonQRFormItems');
  if ($items.length === 0) {
    return '';
  }
  const $clone = $items.clone();
  $clone.find('script, iframe').remove();
  return `<div id="send_form">${$clone.prop('outerHTML')}</div>`;
}

/** 预览模板. 只需在打开面板时构建一次, 之后所有主题共用. */
export interface PreviewTemplate {
  /** 酒馆页面的源, 用作 iframe 的 `<base>` 以便相对路径的图片能加载 */
  origin: string;
  stylesheets: string;
  message: string;
  topBar: string;
  inputArea: string;
}

export function buildPreviewTemplate(): PreviewTemplate {
  const origin = getTavernDocument().location.origin;

  const stylesheets = getTavernStylesheetUrls(origin)
    .map(url => `<link rel="stylesheet" href="${_.escape(url)}">`)
    .join('');

  return {
    origin,
    stylesheets,
    message: getMessageTemplate(),
    topBar: cloneTopBarTemplate(),
    inputArea: cloneInputAreaTemplate(),
  };
}

/**
 * 压平预览窗口的布局.
 *
 * 酒馆的 `#sheld` 是绝对定位并按 `--sheldWidth` 居中的, 直接搬进小窗口会错位;
 * 这里把它改为填满整个 iframe.
 *
 * 背景照抄酒馆的做法: `#bg1` 铺背景图, 底下由 `html` 垫上主题自己的 `blur_tint_color`.
 * 这样半透明主题不会直接压在卡片的白底上, 而是显出主题该有的色调.
 */
function getLayoutOverrides(theme: Theme): string {
  return `
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      overflow: hidden !important;
    }
    /*
     * 底色垫在 html 上而不是 body 上: 不少主题的 custom_css 给 body 设的是半透明色,
     * 靠底下透出来的东西成色. 若在 body 上强设底色, 这些主题就会失真.
     */
    html { background: ${theme.blur_tint_color} !important; }
    body {
      display: flex !important;
      flex-direction: column !important;
      height: 100% !important;
    }
    /* 与酒馆一致的背景层. 图片是酒馆背景列表里的第一张 (全透明), 由它透出上面的底色 */
    #bg1 {
      position: absolute !important;
      inset: 0 !important;
      z-index: -1 !important;
      background-image: url('${PREVIEW_BACKGROUND}') !important;
      background-position: center !important;
      background-size: cover !important;
      background-repeat: no-repeat !important;
    }
    /*
     * 顶栏在酒馆里是固定定位且靠 flex 均分整个宽度. 预览里改成普通流内元素并允许
     * 换行: 窄到一行放不下时图标折到下一行, 而不是溢出到看不见的地方.
     */
    #top-settings-holder {
      position: relative !important;
      flex: 0 0 auto !important;
      display: flex !important;
      flex-wrap: wrap !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      min-height: 30px !important;
      justify-content: space-around !important;
      align-items: center !important;
      overflow: visible !important;
      box-sizing: border-box !important;
    }
    /* 顶栏的底色层: 酒馆里它是固定定位的空元素, 这里改为铺满图标区 */
    #top-bar {
      position: absolute !important;
      inset: 0 !important;
      z-index: 0 !important;
      width: 100% !important;
      height: auto !important;
    }
    /*
     * 抽屉在酒馆里宽度是 100%, 再靠 flex 收缩到图标那么宽. 预览里允许换行, 若仍是
     * 100% 每个抽屉都会独占一行, 因此改成按内容定宽.
     */
    #top-settings-holder > .drawer {
      position: relative !important;
      z-index: 1 !important;
      flex: 0 0 auto !important;
      width: auto !important;
      min-width: 0 !important;
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
    }
    #sheld {
      position: static !important;
      flex: 1 1 auto !important;
      width: 100% !important;
      max-width: none !important;
      min-width: 0 !important;
      height: auto !important;
      min-height: 0 !important;
      inset: auto !important;
      transform: none !important;
      margin: 0 !important;
      display: flex !important;
      flex-direction: column !important;
    }
    #chat {
      flex: 1 1 auto !important;
      height: auto !important;
      max-height: none !important;
      min-height: 0 !important;
      overflow: hidden !important;
      padding: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
    }
    #send_form {
      position: static !important;
      flex: 0 0 auto !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    /* 输入区在酒馆里靠 fixed 定位撑开, 流内布局下要自己保证不被压扁 */
    #nonQRFormItems {
      display: flex !important;
      align-items: center !important;
      width: 100% !important;
      box-sizing: border-box !important;
    }
    #send_textarea {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      height: auto !important;
      min-height: 2em !important;
    }
    .mes { margin: 0 !important; }
    /* 预览不需要交互, 隐藏滚动条与滑动箭头 */
    * { scrollbar-width: none !important; }
    *::-webkit-scrollbar { display: none !important; }
    .swipe_left, .swipe_right { display: none !important; }`;
}

/** 生成某个主题的预览 iframe srcdoc */
export function buildPreviewSrcdoc(theme: Theme, template: PreviewTemplate): string {
  // 主题来自用户导入的文件, custom_css 里若出现 </style> 会提前闭合样式标签,
  // 使后续内容被当作 HTML 解析. 拆开这个序列即可, 不影响 CSS 语义.
  const custom_css = theme.custom_css.replaceAll(/<\/(style)/gi, '<\\/$1');

  return [
    '<!DOCTYPE html>',
    `<html style="${_.escape(getThemeCssVariables(theme))}">`,
    '<head>',
    `<base href="${_.escape(template.origin)}/">`,
    template.stylesheets,
    // id 与酒馆一致, 让 custom_css 中针对 #custom-style 的规则也能生效
    `<style id="custom-style">${custom_css}</style>`,
    `<style>${getLayoutOverrides(theme)}</style>`,
    '</head>',
    `<body class="${_.escape(getThemeBodyClasses(theme))}">`,
    // 与酒馆一致的背景层, 让针对 #bg1 的 custom_css 也能生效
    '<div id="bg1"></div>',
    template.topBar,
    `<div id="sheld"><div id="chat">${template.message}</div></div>`,
    template.inputArea,
    '</body>',
    '</html>',
  ].join('');
}
