<template>
  <div class="theme-panel">
    <header class="theme-panel__header">
      <!-- 标题、搜索、操作挤在一行: 面板高度全留给缩略图 -->
      <div class="theme-panel__row">
        <h1 class="theme-panel__title">
          UI 主题
          <span class="theme-panel__count">
            <template v-if="store.loading">读取中…</template>
            <template v-else-if="store.loadError">读取失败</template>
            <template v-else>{{ store.themes.length }}</template>
          </span>
        </h1>

        <input v-model="store.search" class="theme-panel__search" type="search" placeholder="搜索主题名" />
        <button
          class="theme-panel__button theme-panel__button--icon"
          :class="{ 'theme-panel__button--active': store.favoritesOnly }"
          type="button"
          title="只看收藏的主题"
          @click="store.favoritesOnly = !store.favoritesOnly"
        >
          {{ store.favoritesOnly ? '★' : '☆' }}
        </button>
        <button class="theme-panel__button" type="button" @click="pickFile">导入</button>
        <button class="theme-panel__button" type="button" :disabled="store.loading" @click="store.load(true)">
          刷新
        </button>
        <button class="theme-panel__close" type="button" title="关闭" aria-label="关闭" @click="emit('close')">
          ✕
        </button>
      </div>

      <!-- 整理选项一行放平: 选项文字本身已说明用途, 不再另加标签, 省下横向空间 -->
      <div class="theme-panel__row theme-panel__row--options">
        <select v-model="settings.groupMode" class="theme-panel__select" title="分组方式">
          <option value="auto">前缀分组</option>
          <option value="custom">我的分组</option>
          <option value="none">不分组</option>
        </select>

        <!-- 加号紧跟分组下拉框: 建分组这件事就发生在「分组」这里 -->
        <input
          v-if="creatingGroup"
          v-model="newGroupName"
          v-focus
          class="theme-panel__search theme-panel__search--narrow"
          placeholder="新分组名"
          @keyup.enter="createGroup"
          @keyup.esc="cancelCreateGroup"
          @blur="createGroup"
        />
        <button
          v-else
          class="theme-panel__button theme-panel__button--icon"
          type="button"
          title="新建分组"
          @click="creatingGroup = true"
        >
          ＋
        </button>

        <select v-model="sortChoice" class="theme-panel__select" title="排序方式">
          <option v-for="(choice, index) in SORT_CHOICES" :key="index" :value="index">{{ choice.label }}</option>
        </select>

        <label class="theme-panel__field theme-panel__field--check" title="收藏的主题排在最前">
          <input v-model="settings.favoriteFirst" type="checkbox" />
          收藏置顶
        </label>

        <label class="theme-panel__field">
          每排
          <select v-model.number="columns" class="theme-panel__select">
            <option v-for="count in COLUMN_CHOICES" :key="count" :value="count">{{ count }}</option>
          </select>
        </label>
      </div>
    </header>

    <!-- 试穿中常驻提醒, 避免用户忘记自己改过主题 -->
    <div v-if="store.tryingOn" class="theme-panel__notice">
      <span
        >正在试穿 <strong>{{ store.currentName }}</strong></span
      >
      <button class="theme-panel__button" type="button" @click="store.restore()">
        还原为 {{ store.originalName }}
      </button>
    </div>

    <div v-if="store.loadError" class="theme-panel__state theme-panel__state--error">
      {{ store.loadError }}
    </div>
    <div v-else-if="store.loading" class="theme-panel__state">
      主题数据来自酒馆设置接口, 体积较大, 首次读取可能需要几秒…
    </div>
    <div v-else-if="store.matched.length === 0" class="theme-panel__state">
      {{ emptyHint }}
    </div>

    <div v-else ref="scroller" class="theme-panel__scroller">
      <section v-for="group in store.groups" :key="group.key" class="theme-panel__group">
        <div v-if="group.key !== ''" class="theme-panel__group-head">
          <button class="theme-panel__group-toggle" type="button" @click="toggleCollapsed(group.key)">
            {{ collapsed.has(group.key) ? '▸' : '▾' }}
          </button>

          <input
            v-if="renamingKey === group.key"
            v-model="renameDraft"
            v-focus
            class="theme-panel__rename"
            @keyup.enter="commitRename(group)"
            @keyup.esc="renamingKey = undefined"
            @blur="commitRename(group)"
          />
          <button
            v-else
            class="theme-panel__group-name"
            type="button"
            title="点两下改名"
            @click="toggleCollapsed(group.key)"
            @dblclick="startRename(group)"
          >
            {{ group.name }}
            <span class="theme-panel__group-count">{{ group.themes.length }}</span>
          </button>

          <button class="theme-panel__group-icon" type="button" title="改名" @click="startRename(group)">✎</button>
          <button
            v-if="settings.groupMode === 'custom' && group.key !== UNGROUPED"
            class="theme-panel__group-icon theme-panel__group-icon--danger"
            type="button"
            title="删除分组 (组内主题会回到未分组)"
            @click="settingsStore.removeCustomGroup(group.key)"
          >
            ×
          </button>
        </div>

        <template v-if="!collapsed.has(group.key)">
          <p v-if="group.themes.length === 0" class="theme-panel__group-empty">
            还是空的. 在卡片下方的下拉框里选「{{ group.name }}」就能把主题放进来.
          </p>
          <div v-else class="theme-panel__grid" :style="gridStyle">
            <ThemeCard
              v-for="theme in group.themes"
              :key="theme.name"
              :theme="theme"
              :template="template"
              :is-current="theme.name === store.currentName"
              :is-favorite="favoriteSet.has(theme.name)"
              :card-width="cardWidth"
              :custom-groups="settings.customGroups"
              :group-name="settings.groupOfTheme[theme.name]"
              @try-on="store.tryOn"
              @use="store.use"
              @toggle-favorite="settingsStore.toggleFavorite"
              @set-group="settingsStore.setThemeGroup"
            />
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { SORT_CHOICES, UNGROUPED, type ThemeGroup } from './organize';
import { buildPreviewTemplate } from './preview';
import { useSettingsStore, useThemeStore } from './store';
import ThemeCard from './ThemeCard.vue';

const emit = defineEmits<{ close: [] }>();

const store = useThemeStore();
const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

/**
 * 每排显示几张卡片.
 *
 * 直接读写 `settings` 上当前设备对应的那个字段, 与分组、排序等选项走同一条路.
 */
const columns = computed({
  get: () => settings.value[settingsStore.columnsKey],
  set: (value: number) => {
    settings.value[settingsStore.columnsKey] = value;
  },
});

/** 输入框一出现就聚焦并全选, 省得用户再点一下 */
const vFocus = {
  mounted: (element: HTMLInputElement) => {
    element.focus();
    element.select();
  },
};

/** 可选的每排数量. 排数越少卡片越大越清晰, 同屏 iframe 也越少 */
const COLUMN_CHOICES = [1, 2, 3, 4, 5, 6];

// 预览模板只构建一次: 克隆酒馆 DOM 的开销不小, 且所有卡片共用同一份
const template = buildPreviewTemplate();

const favoriteSet = computed(() => new Set(settings.value.favorites));

/** 已折叠的分组, 记的是分组标识而不是显示名, 这样改名不会丢失折叠状态 */
const collapsed = ref(new Set<string>());

function toggleCollapsed(key: string): void {
  const next = new Set(collapsed.value);
  if (!next.delete(key)) {
    next.add(key);
  }
  collapsed.value = next;
}

/** 正在改名的分组标识 */
const renamingKey = ref<string | undefined>(undefined);
const renameDraft = ref('');

function startRename(group: ThemeGroup): void {
  renamingKey.value = group.key;
  renameDraft.value = group.name;
}

/**
 * 提交改名.
 *
 * 自建分组是真的改名 (卡片上的选组下拉框也跟着变); 按名字前缀分出来的组和「未分组」
 * 是算出来的, 改不了真名, 只能记一个显示用的别名.
 */
function commitRename(group: ThemeGroup): void {
  // Esc 取消时输入框会被移除并触发 blur, 这里挡掉这种情况
  if (renamingKey.value !== group.key) {
    return;
  }
  const name = renameDraft.value.trim();
  renamingKey.value = undefined;

  if (settings.value.groupMode === 'custom' && group.key !== UNGROUPED) {
    settingsStore.renameCustomGroup(group.key, name);
  } else {
    settingsStore.setGroupAlias(group.key, name);
  }
}

/** 排序下拉框选中的是 `SORT_CHOICES` 的下标, 存起来的仍是排序方式与方向两个字段 */
const sortChoice = computed({
  get: () => {
    const index = SORT_CHOICES.findIndex(
      choice => choice.key === settings.value.sortKey && choice.descending === settings.value.sortDescending,
    );
    return index === -1 ? 0 : index;
  },
  set: (index: number) => {
    const choice = SORT_CHOICES[index];
    settings.value.sortKey = choice.key;
    settings.value.sortDescending = choice.descending;
  },
});

const emptyHint = computed(() => {
  if (store.themes.length === 0) {
    return '没有找到任何主题';
  }
  if (store.favoritesOnly && settings.value.favorites.length === 0) {
    return '还没有收藏任何主题, 点卡片右上角的星标即可收藏';
  }
  return '没有匹配的主题';
});

const creatingGroup = ref(false);
const newGroupName = ref('');

function createGroup(): void {
  settingsStore.addCustomGroup(newGroupName.value);
  newGroupName.value = '';
  creatingGroup.value = false;
}

/** 放弃新建. 先清掉草稿再收起输入框, 否则收起时触发的 blur 会把它建出来 */
function cancelCreateGroup(): void {
  newGroupName.value = '';
  creatingGroup.value = false;
}

const scroller = ref<HTMLElement | null>(null);
const { width: scrollerWidth } = useElementSize(scroller);

/** 卡片间距, 需与下方 CSS 里 `.theme-panel__grid` 的 gap 保持一致 */
const CARD_GAP = 16;

const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`,
}));

/**
 * 按面板实际宽度算出每张卡片的真实像素宽, 供子组件计算 iframe 缩放比.
 *
 * 不再为滚动条另留余量: `useElementSize` 量的是内容盒宽度, 滚动条已经不算在内,
 * 再减一次就会让 iframe 比卡片窄一截, 右边露出一条空白.
 */
const cardWidth = computed(() => {
  const count = columns.value;
  if (scrollerWidth.value === 0) {
    return 180;
  }
  const available = scrollerWidth.value - CARD_GAP * (count - 1);
  return Math.max(80, available / count);
});

function pickFile(): void {
  const $input = $('<input type="file" accept=".json,application/json">');
  $input.on('change', async () => {
    const file = ($input[0] as HTMLInputElement).files?.[0];
    if (!file) {
      return;
    }
    try {
      await store.importFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[UI主题管理] 导入失败', error);
      toastr.error(message, '导入失败');
    }
  });
  $input.trigger('click');
}

onMounted(() => store.load());
</script>

<style scoped>
/* 浅色 ins 风: 近白底、大量留白、细浅灰分隔线、无重阴影 */
.theme-panel {
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 12px 16px 16px;
  overflow: hidden;
  background: #fafafa;
  color: #2f2f2f;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    'Noto Sans SC',
    sans-serif;
}

.theme-panel__header {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ededed;
}

.theme-panel__row {
  display: flex;
  gap: 8px;
  align-items: center;
  min-width: 0;
}

/* 整理选项放不下就换行: 手机上横向滑动会藏起后面的选项, 用户根本不知道它们存在 */
.theme-panel__row--options {
  flex-wrap: wrap;
  gap: 6px;
  padding-bottom: 2px;
}

/*
 * 电脑宽屏时把两行并成一行: 两组东西加起来约 820px, 900px 以上就放得下, 再分两行
 * 右边会空一大片.
 *
 * `display: contents` 让两个分组自己消失、把子元素直接交给 header 排, 这样一行里
 * 的间距才是均匀的; 关闭键靠 order 排到最后, 免得卡在中间.
 */
@media (min-width: 900px) {
  .theme-panel__header {
    flex-flow: row wrap;
    gap: 8px;
    align-items: center;
  }

  .theme-panel__row {
    display: contents;
  }

  .theme-panel__search {
    max-width: 320px;
  }

  .theme-panel__close {
    order: 1;
    margin-left: auto;
  }
}

.theme-panel__title {
  flex: 0 0 auto;
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.theme-panel__count {
  margin-left: 4px;
  color: #a8a8a8;
  font-size: 12px;
  font-weight: 400;
}

.theme-panel__close {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: none;
  color: #8e8e8e;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.theme-panel__close:hover {
  background: #efefef;
  color: #2f2f2f;
}

.theme-panel__search {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 72px;
  max-width: 260px;
  padding: 6px 12px;
  border: 1px solid #e4e4e4;
  border-radius: 999px;
  background: #fff;
  color: #2f2f2f;
  font-size: 12.5px;
}

.theme-panel__search:focus {
  border-color: #c9c9c9;
  outline: none;
}

.theme-panel__button {
  flex: 0 0 auto;
  padding: 6px 12px;
  border: 1px solid #e4e4e4;
  border-radius: 999px;
  background: #fff;
  color: #2f2f2f;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.theme-panel__button--icon {
  padding: 6px 9px;
}

.theme-panel__button:hover:not(:disabled) {
  background: #f2f2f2;
}

.theme-panel__button:disabled {
  color: #b5b5b5;
  cursor: default;
}

.theme-panel__button--active {
  border-color: #d8cfb8;
  background: #fbf8f2;
  color: #7a6a45;
}

.theme-panel__field {
  display: flex;
  flex: 0 0 auto;
  gap: 5px;
  align-items: center;
  color: #8e8e8e;
  font-size: 12.5px;
  white-space: nowrap;
}

.theme-panel__field--check {
  cursor: pointer;
}

.theme-panel__notice {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  padding: 8px 14px;
  border: 1px solid #ece7dc;
  border-radius: 12px;
  background: #fbf8f2;
  font-size: 12.5px;
}

.theme-panel__state {
  flex: 1 1 auto;
  padding: 40px 0;
  color: #9a9a9a;
  font-size: 13px;
  text-align: center;
}

.theme-panel__state--error {
  color: #b4544f;
}

.theme-panel__scroller {
  flex: 1 1 auto;
  margin-top: 10px;
  padding-bottom: 8px;
  overflow-y: auto;
}

.theme-panel__group + .theme-panel__group {
  margin-top: 22px;
}

.theme-panel__group-head {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px 0;
}

.theme-panel__group-toggle {
  padding: 2px 3px;
  border: none;
  background: none;
  color: #9a9a9a;
  font-size: 11px;
  cursor: pointer;
}

.theme-panel__group-name {
  overflow: hidden;
  max-width: 60%;
  padding: 2px 0;
  border: none;
  background: none;
  color: #4a4a4a;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}

.theme-panel__group-count {
  margin-left: 5px;
  color: #a8a8a8;
  font-size: 11.5px;
  font-weight: 400;
}

/* 改名输入框沿用组名的字号字重, 改名前后不跳动 */
.theme-panel__rename {
  box-sizing: border-box;
  width: 170px;
  padding: 2px 8px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  color: #2f2f2f;
  font-size: 13px;
  font-weight: 600;
}

.theme-panel__rename:focus {
  border-color: #b9b3a6;
  outline: none;
}

.theme-panel__group-icon {
  padding: 0 5px;
  border: none;
  background: none;
  color: #a8a8a8;
  font-size: 12px;
  cursor: pointer;
}

.theme-panel__group-icon:hover {
  color: #4a4a4a;
}

.theme-panel__group-icon--danger {
  font-size: 15px;
}

.theme-panel__group-icon--danger:hover {
  color: #b4544f;
}

.theme-panel__group-empty {
  margin: 0;
  padding: 0 0 4px 20px;
  color: #a8a8a8;
  font-size: 12px;
}

.theme-panel__grid {
  display: grid;
  gap: 16px;
}

.theme-panel__search--narrow {
  flex: 0 0 110px;
}

.theme-panel__select {
  flex: 0 0 auto;
  padding: 5px 7px;
  border: 1px solid #e4e4e4;
  border-radius: 999px;
  background: #fff;
  color: #2f2f2f;
  font-size: 12px;
  cursor: pointer;
}
</style>
