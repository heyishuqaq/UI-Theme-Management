import { getAutoGroup, groupThemes, SORT_KEYS, sortThemes, UNGROUPED, type ThemeGroup } from './organize';
import { applyTheme, fetchThemes, getCurrentThemeName, importTheme } from './tavern';
import type { Theme } from './theme';

/**
 * 用户设置, 存在脚本变量里, 换聊天或重启酒馆都会保留.
 *
 * 收藏与自定义分组都以主题名为键 —— 主题没有 id, 名字是酒馆里唯一的标识.
 */
const Settings = z
  .object({
    /**
     * 每排显示几张卡片. 卡片越少越大越清晰, 也越省性能.
     *
     * 电脑与手机分开记: 设置存在脚本变量里, 两端共用同一份, 而一个值不可能同时适合
     * 两种屏幕 —— 手机上 3 列每张只有几十像素宽, 电脑上 1 列又浪费整屏.
     */
    columns: z.number().min(1).max(8).default(3),
    mobileColumns: z.number().min(1).max(8).default(1),
    /** 收藏的主题名 */
    favorites: z.array(z.string()).default([]),
    favoriteFirst: z.boolean().default(true),
    sortKey: z.enum(SORT_KEYS).default('original'),
    sortDescending: z.boolean().default(false),
    /** 分组依据: 自动识别名字前缀, 或使用自建分组 */
    groupMode: z.enum(['auto', 'custom', 'none']).default('auto'),
    /** 自建分组名列表. 单独存一份, 这样空分组不会消失. */
    customGroups: z.array(z.string()).default([]),
    /** 主题名 → 自建分组名 */
    groupOfTheme: z.record(z.string(), z.string()).default({}),
    /**
     * 分组标识 → 用户起的显示名.
     *
     * 只用于算出来的分组 (名字前缀、「未分组」): 它们的组名由规则决定, 改不了真名,
     * 只能记一个显示用的别名. 自建分组是真改名, 不走这里.
     */
    groupAliases: z.record(z.string(), z.string()).default({}),
  })
  .prefault({});

/** 手机屏幕的宽度上限, 与酒馆自己判断窄屏的断点一致 */
const MOBILE_WIDTH = 768;

/**
 * 当前是否手机屏幕.
 *
 * 量的是酒馆页面的宽度, 而不是脚本自己的 `window.innerWidth` —— 脚本跑在酒馆的
 * iframe 里, 那个宽度只有聊天区那么宽, 电脑上也常常不到 768, 会被误判成手机.
 */
function isMobileScreen(): boolean {
  const width = $('body')[0]?.ownerDocument.defaultView?.innerWidth ?? window.innerWidth;
  return width < MOBILE_WIDTH;
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref(Settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));

  /**
   * 当前设备该用的「每排数量」字段名. 设备类型一次判定即可: 同一次使用中不会从手机变成电脑.
   *
   * 这里只给字段名, 由界面自己读写 `settings` 上的这个字段 —— 其余选项 (分组、排序) 都是
   * 这么直接改 `settings` 的, 每排数量也照同一条路走.
   */
  const columnsKey: 'columns' | 'mobileColumns' = isMobileScreen() ? 'mobileColumns' : 'columns';

  watchEffect(() => {
    // 用 replaceVariables 而非 insertOrAssign: 后者会与旧值深度合并, 导致取消收藏、
    // 删除分组这类「移除元素」的改动无法生效
    replaceVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
  });

  function toggleFavorite(name: string): void {
    const favorites = settings.value.favorites;
    settings.value.favorites = favorites.includes(name)
      ? favorites.filter(favorite => favorite !== name)
      : [...favorites, name];
  }

  function addCustomGroup(name: string): void {
    const trimmed = name.trim();
    if (trimmed === '') {
      return;
    }
    // 顺手切到自建分组视图: 否则新建的分组在前缀分组视图里看不见, 像是没建成
    settings.value.groupMode = 'custom';
    if (settings.value.customGroups.includes(trimmed)) {
      toastr.info(trimmed, '分组已存在');
      return;
    }
    settings.value.customGroups = [...settings.value.customGroups, trimmed];
  }

  function removeCustomGroup(name: string): void {
    settings.value.customGroups = settings.value.customGroups.filter(group => group !== name);
    settings.value.groupOfTheme = _.omitBy(settings.value.groupOfTheme, group => group === name);
  }

  /** 给自建分组改名. 改成一个已存在的组名等于把两组合并. */
  function renameCustomGroup(oldName: string, newName: string): void {
    const trimmed = newName.trim();
    if (trimmed === '' || trimmed === oldName) {
      return;
    }
    // uniq 负责合并: 改成已有组名时, 列表里会出现两个同名项, 去重后即为同一组.
    // 组名不在列表里 (旧数据留下的孤儿分组) 时补进去, 保证任何分组都改得动.
    const groups = settings.value.customGroups;
    settings.value.customGroups = _.uniq(
      groups.includes(oldName) ? groups.map(group => (group === oldName ? trimmed : group)) : [...groups, trimmed],
    );
    settings.value.groupOfTheme = _.mapValues(settings.value.groupOfTheme, group =>
      group === oldName ? trimmed : group,
    );
  }

  /**
   * 给算出来的分组起别名, 也就是给它改个显示名.
   *
   * 传入原名 (或空) 表示恢复默认显示.
   */
  function setGroupAlias(key: string, name: string): void {
    const trimmed = name.trim();
    const next = { ...settings.value.groupAliases };
    if (trimmed === '' || trimmed === key) {
      delete next[key];
    } else {
      next[key] = trimmed;
    }
    settings.value.groupAliases = next;
  }

  /** 把主题移入分组; 传 undefined 表示移出分组 */
  function setThemeGroup(themeName: string, groupName: string | undefined): void {
    const next = { ...settings.value.groupOfTheme };
    if (groupName === undefined) {
      delete next[themeName];
    } else {
      next[themeName] = groupName;
    }
    settings.value.groupOfTheme = next;
  }

  return {
    settings,
    columnsKey,
    toggleFavorite,
    addCustomGroup,
    removeCustomGroup,
    renameCustomGroup,
    setGroupAlias,
    setThemeGroup,
  };
});

export const useThemeStore = defineStore('theme', () => {
  const settingsStore = useSettingsStore();

  const themes = ref<Theme[]>([]);
  const loading = ref(false);
  const loadError = ref<string | undefined>(undefined);
  const search = ref('');

  /** 酒馆当前使用的主题名 */
  const currentName = ref<string | undefined>(getCurrentThemeName());

  /** 试穿前的原主题名. 有值表示正在试穿, 可以还原. */
  const originalName = ref<string | undefined>(undefined);
  const tryingOn = computed(() => originalName.value !== undefined);

  /** 只看收藏 */
  const favoritesOnly = ref(false);

  const matched = computed(() => {
    const keyword = search.value.trim().toLowerCase();
    const favorites = new Set(settingsStore.settings.favorites);
    return themes.value.filter(theme => {
      if (favoritesOnly.value && !favorites.has(theme.name)) {
        return false;
      }
      return keyword === '' || theme.name.toLowerCase().includes(keyword);
    });
  });

  const sorted = computed(() =>
    sortThemes(matched.value, {
      key: settingsStore.settings.sortKey,
      descending: settingsStore.settings.sortDescending,
      favoriteFirst: settingsStore.settings.favoriteFirst,
      favorites: settingsStore.settings.favorites,
    }),
  );

  /** 分好组的主题. 分组关闭时返回单个无名分组, 由界面决定不显示组标题. */
  const groups = computed<ThemeGroup[]>(() => {
    const { groupMode, groupOfTheme, groupAliases, customGroups } = settingsStore.settings;
    switch (groupMode) {
      case 'auto':
        return groupThemes(sorted.value, {
          keyOf: theme => getAutoGroup(theme.name) ?? UNGROUPED,
          nameOf: key => groupAliases[key] ?? key,
        });
      case 'custom':
        return groupThemes(sorted.value, {
          keyOf: theme => groupOfTheme[theme.name] ?? UNGROUPED,
          // 自建分组是真改名, 只有「未分组」这个算出来的分组要查别名
          nameOf: key => (key === UNGROUPED ? (groupAliases[key] ?? key) : key),
          order: customGroups,
        });
      case 'none':
        return [{ key: '', name: '', themes: sorted.value }];
    }
  });

  /**
   * 读取主题列表.
   *
   * 数据只能从体积很大的酒馆设置接口取得, 所以默认只在首次打开时读取一次.
   */
  async function load(force = false): Promise<void> {
    if (loading.value || (themes.value.length > 0 && !force)) {
      return;
    }
    loading.value = true;
    loadError.value = undefined;
    try {
      themes.value = await fetchThemes();
      currentName.value = getCurrentThemeName();
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : String(error);
      console.error('[UI主题管理] 读取主题失败', error);
    } finally {
      loading.value = false;
    }
  }

  /** 切换酒馆主题. 若正在试穿, 则本次切换视为确认使用. */
  function use(name: string): void {
    applyTheme(name);
    currentName.value = name;
    originalName.value = undefined;
    toastr.success(name, '已切换主题');
  }

  /** 试穿: 真的切过去看效果, 记住原主题以便还原 */
  function tryOn(name: string): void {
    if (originalName.value === undefined) {
      originalName.value = currentName.value;
    }
    applyTheme(name);
    currentName.value = name;
  }

  /** 还原到试穿之前的主题 */
  function restore(): void {
    const original = originalName.value;
    originalName.value = undefined;
    if (original === undefined) {
      return;
    }
    applyTheme(original);
    currentName.value = original;
    toastr.info(original, '已还原主题');
  }

  /** 导入主题文件, 成功后立刻出现在列表里 */
  async function importFile(file: File): Promise<void> {
    const theme = await importTheme(file);
    // 酒馆的导入会拒绝重名, 所以这里不会产生重复项
    themes.value = [...themes.value, theme];
    toastr.success(theme.name, '已导入主题');
  }

  /** 酒馆里主题变了 (例如用户在用户设置面板里切换了) 时同步过来 */
  function syncCurrentFromTavern(): void {
    const name = getCurrentThemeName();
    if (name !== currentName.value) {
      currentName.value = name;
    }
  }

  return {
    themes,
    loading,
    loadError,
    search,
    favoritesOnly,
    currentName,
    originalName,
    tryingOn,
    groups,
    matched,
    load,
    use,
    tryOn,
    restore,
    importFile,
    syncCurrentFromTavern,
  };
});
