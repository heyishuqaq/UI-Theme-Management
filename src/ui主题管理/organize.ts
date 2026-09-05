import type { Theme } from './theme';

/**
 * 主题的整理方式: 自动分组、自定义分组、排序.
 */

/** 名字前缀所用的括号对. 主题作者习惯用 `[渐变]`、`【SAYA】` 这类前缀标记系列. */
const BRACKET_PAIRS = [
  ['[', ']'],
  ['【', '】'],
  ['（', '）'],
  ['(', ')'],
  ['〖', '〗'],
  ['「', '」'],
  ['『', '』'],
  ['《', '》'],
] as const;

/** 未能自动识别出前缀的主题归入此组 */
export const UNGROUPED = '未分组';

/**
 * 从主题名开头的括号里取出组名.
 *
 * 只认开头的括号: 名字中间出现的括号通常是描述而非系列标记
 * (例如「-春晓-（带头像框）」的括号说的是这一个主题的特点).
 */
export function getAutoGroup(name: string): string | undefined {
  const trimmed = name.trim();
  for (const [open, close] of BRACKET_PAIRS) {
    if (!trimmed.startsWith(open)) {
      continue;
    }
    const end = trimmed.indexOf(close, open.length);
    if (end <= open.length) {
      continue;
    }
    const group = trimmed.slice(open.length, end).trim();
    if (group !== '') {
      return group;
    }
  }
  return undefined;
}

/** 主题底色的感知亮度, 0 为纯黑 1 为纯白. 无法解析时返回 undefined. */
export function getLuminance(theme: Theme): number | undefined {
  const parts = theme.blur_tint_color.match(/[\d.]+/g);
  if (parts === null || parts.length < 3) {
    return undefined;
  }
  const [red, green, blue] = parts.map(Number);
  // ITU-R BT.601 亮度权重, 与人眼对各原色的敏感度相符
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

export const SORT_KEYS = ['name', 'original', 'luminance'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * 排序方式与方向的组合, 供界面用一个下拉框选完.
 *
 * 合成一个下拉框是为了省横向空间: 工具栏要在窄屏上排成一行.
 */
export const SORT_CHOICES = [
  { key: 'original', descending: false, label: '原始顺序 旧→新' },
  { key: 'original', descending: true, label: '原始顺序 新→旧' },
  { key: 'name', descending: false, label: '名字 A→Z' },
  { key: 'name', descending: true, label: '名字 Z→A' },
  { key: 'luminance', descending: false, label: '底色 深→浅' },
  { key: 'luminance', descending: true, label: '底色 浅→深' },
] as const satisfies readonly { key: SortKey; descending: boolean; label: string }[];

/** 中文按拼音排序 */
const collator = new Intl.Collator('zh-Hans-CN');

export interface SortOptions {
  key: SortKey;
  descending: boolean;
  /** 收藏的主题是否置顶. 与其他排序方式叠加生效. */
  favoriteFirst: boolean;
  favorites: readonly string[];
}

/**
 * 排序主题列表.
 *
 * 传入的数组顺序即「原始顺序」, 也就是酒馆设置里的存储顺序 —— 主题数据里没有日期
 * 字段, 这是最接近「添加先后」的信息, 但并不保证准确.
 */
export function sortThemes(themes: readonly Theme[], options: SortOptions): Theme[] {
  const favorites = new Set(options.favorites);
  const direction = options.descending ? -1 : 1;

  return themes
    .map((theme, index) => ({ theme, index }))
    .sort((lhs, rhs) => {
      if (options.favoriteFirst) {
        const diff = Number(favorites.has(rhs.theme.name)) - Number(favorites.has(lhs.theme.name));
        if (diff !== 0) {
          return diff;
        }
      }

      switch (options.key) {
        case 'name':
          return direction * collator.compare(lhs.theme.name, rhs.theme.name);
        case 'luminance': {
          // 无法解析底色的主题排在最后, 不参与深浅比较
          const lhsLuminance = getLuminance(lhs.theme);
          const rhsLuminance = getLuminance(rhs.theme);
          if (lhsLuminance === undefined || rhsLuminance === undefined) {
            return Number(lhsLuminance === undefined) - Number(rhsLuminance === undefined);
          }
          return direction * (lhsLuminance - rhsLuminance);
        }
        case 'original':
          return direction * (lhs.index - rhs.index);
      }
    })
    .map(entry => entry.theme);
}

export interface ThemeGroup {
  /** 分组的身份标识: 自动分组是名字前缀, 自建分组是组名本身. 改名、折叠都以它为准. */
  key: string;
  /** 显示用的名字. 用户给分组改过名时与 `key` 不同. */
  name: string;
  themes: Theme[];
}

export interface GroupOptions {
  /** 返回某个主题所属分组的标识 */
  keyOf: (theme: Theme) => string;
  /** 标识 → 显示名. 默认直接拿标识当名字. */
  nameOf?: (key: string) => string;
  /**
   * 一定要出现的分组标识, 分组也按此顺序排列.
   *
   * 自建分组用得上: 刚新建的空分组也要露出来 (否则用户以为没建成), 且顺序应该是
   * 用户新建的先后而不是成员多少.
   */
  order?: readonly string[];
}

/**
 * 按分组标识把主题分堆.
 *
 * @returns `order` 里的分组在前并保持其顺序, 其余按成员数从多到少, `未分组` 永远在最后
 */
export function groupThemes(themes: readonly Theme[], options: GroupOptions): ThemeGroup[] {
  const { keyOf, nameOf = key => key, order = [] } = options;

  const buckets = new Map<string, Theme[]>(order.map(key => [key, []]));
  for (const theme of themes) {
    const key = keyOf(theme);
    const members = buckets.get(key);
    if (members === undefined) {
      buckets.set(key, [theme]);
    } else {
      members.push(theme);
    }
  }

  const ranks = new Map(order.map((key, index) => [key, index]));
  return [...buckets.entries()]
    .map(([key, members]) => ({ key, name: nameOf(key), themes: members }))
    .sort((lhs, rhs) => {
      if (lhs.key === UNGROUPED || rhs.key === UNGROUPED) {
        return Number(lhs.key === UNGROUPED) - Number(rhs.key === UNGROUPED);
      }
      const lhsRank = ranks.get(lhs.key);
      const rhsRank = ranks.get(rhs.key);
      if (lhsRank !== undefined || rhsRank !== undefined) {
        return (lhsRank ?? Number.MAX_SAFE_INTEGER) - (rhsRank ?? Number.MAX_SAFE_INTEGER);
      }
      return rhs.themes.length - lhs.themes.length || collator.compare(lhs.name, rhs.name);
    });
}
