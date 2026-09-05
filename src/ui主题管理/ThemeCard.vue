<template>
  <div class="theme-card" :class="{ 'theme-card--current': isCurrent }">
    <div ref="frameBox" class="theme-card__frame" :style="{ height: `${frameHeight}px` }">
      <!-- 只有滚到附近才创建 iframe, 离开视野即销毁 -->
      <iframe
        v-if="rendered"
        class="theme-card__iframe"
        :srcdoc="srcdoc"
        :style="iframeStyle"
        sandbox="allow-same-origin"
        :title="`${theme.name} 预览`"
      ></iframe>
      <div v-else class="theme-card__placeholder"></div>

      <button
        class="theme-card__favorite"
        :class="{ 'theme-card__favorite--on': isFavorite }"
        type="button"
        :title="isFavorite ? '取消收藏' : '收藏'"
        :aria-pressed="isFavorite"
        @click="emit('toggleFavorite', theme.name)"
      >
        {{ isFavorite ? '★' : '☆' }}
      </button>

      <div class="theme-card__actions">
        <button class="theme-card__action" type="button" @click="emit('tryOn', theme.name)">试穿</button>
        <button class="theme-card__action theme-card__action--primary" type="button" @click="emit('use', theme.name)">
          使用
        </button>
      </div>
    </div>

    <div class="theme-card__meta">
      <span class="theme-card__name" :title="theme.name">{{ theme.name }}</span>
      <span v-if="isCurrent" class="theme-card__badge">当前</span>
    </div>

    <!-- 建过分组就一直显示选组框, 不限于自建分组视图 -->
    <select v-if="customGroups.length > 0" class="theme-card__group" :value="groupName ?? ''" @change="onGroupChange">
      <option value="">未分组</option>
      <option v-for="group in customGroups" :key="group" :value="group">{{ group }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { useElementVisibility } from '@vueuse/core';
import { buildPreviewSrcdoc, PREVIEW_HEIGHT, PREVIEW_WIDTH, type PreviewTemplate } from './preview';
import { queueRender } from './render_queue';
import type { Theme } from './theme';

const props = defineProps<{
  theme: Theme;
  template: PreviewTemplate;
  isCurrent: boolean;
  isFavorite: boolean;
  /** 卡片实际像素宽度, 用来算 iframe 缩放比例 */
  cardWidth: number;
  /** 可选的自建分组. 为空数组时不显示选组下拉框. */
  customGroups: readonly string[];
  /** 本主题所属的自建分组 */
  groupName: string | undefined;
}>();

const emit = defineEmits<{
  tryOn: [name: string];
  use: [name: string];
  toggleFavorite: [name: string];
  setGroup: [name: string, group: string | undefined];
}>();

function onGroupChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('setGroup', props.theme.name, value === '' ? undefined : value);
}

const frameBox = ref<HTMLElement | null>(null);
const rendered = ref(false);

/*
 * 离开视野就销毁 iframe. 与「渲染过就永久保留」相比多了重建成本, 但几百个主题
 * 全部保留会累积到浏览器卡死 —— 每个 iframe 都持有一份酒馆样式表和主题 CSS.
 */
const inViewport = useElementVisibility(frameBox, { rootMargin: '200px' });
let cancelQueued: (() => void) | undefined;

watch(inViewport, visible => {
  cancelQueued?.();
  cancelQueued = undefined;

  if (visible) {
    cancelQueued = queueRender(() => {
      rendered.value = true;
    });
  } else {
    rendered.value = false;
  }
});

onUnmounted(() => cancelQueued?.());

const srcdoc = computed(() => (rendered.value ? buildPreviewSrcdoc(props.theme, props.template) : ''));

const scale = computed(() => props.cardWidth / PREVIEW_WIDTH);
const frameHeight = computed(() => PREVIEW_HEIGHT * scale.value);

const iframeStyle = computed(() => ({
  width: `${PREVIEW_WIDTH}px`,
  height: `${PREVIEW_HEIGHT}px`,
  transform: `scale(${scale.value})`,
}));
</script>

<style scoped>
.theme-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  content-visibility: auto;
}

/* 统一的白色卡片把五颜六色的缩略图框起来, 整体才不会显得杂乱 */
.theme-card__frame {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid #ececec;
  border-radius: 14px;
  background: #fff;
  transition: box-shadow 0.18s ease;
}

.theme-card:hover .theme-card__frame {
  box-shadow: 0 4px 18px rgb(0 0 0 / 8%);
}

.theme-card--current .theme-card__frame {
  border-color: #b9b3a6;
  box-shadow: 0 0 0 2px #ded8cc;
}

.theme-card__iframe {
  position: absolute;
  top: 0;
  left: 0;
  border: 0;
  transform-origin: top left;
  /* 缩略图只用来看, 点击应落到卡片上 */
  pointer-events: none;
}

.theme-card__placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, #f7f7f7, #f0f0f0);
}

/* 收藏星标常驻显示, 这样一眼就能看出哪些是收藏过的 */
.theme-card__favorite {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgb(255 255 255 / 82%);
  color: #b0b0b0;
  font-size: 13px;
  line-height: 24px;
  cursor: pointer;
}

.theme-card__favorite:hover {
  background: #fff;
  color: #7a7266;
}

.theme-card__favorite--on {
  color: #d8a53c;
}

.theme-card__group {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #ececec;
  border-radius: 8px;
  background: #fff;
  color: #6b6b6b;
  font-size: 11.5px;
  cursor: pointer;
}

/* 悬停时才浮出操作按钮, 平时保持画面干净 */
.theme-card__actions {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  gap: 6px;
  justify-content: center;
  padding: 8px;
  background: linear-gradient(180deg, rgb(255 255 255 / 0%), rgb(255 255 255 / 92%));
  opacity: 0;
  transition: opacity 0.18s ease;
}

.theme-card:hover .theme-card__actions,
.theme-card:focus-within .theme-card__actions {
  opacity: 1;
}

.theme-card__action {
  padding: 5px 14px;
  border: 1px solid #e2e2e2;
  border-radius: 999px;
  background: #fff;
  color: #3a3a3a;
  font-size: 12px;
  cursor: pointer;
}

.theme-card__action:hover {
  background: #f5f5f5;
}

.theme-card__action--primary {
  border-color: #2c2c2c;
  background: #2c2c2c;
  color: #fff;
}

.theme-card__action--primary:hover {
  background: #444;
}

.theme-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 0 2px;
}

.theme-card__name {
  overflow: hidden;
  color: #2f2f2f;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.theme-card__badge {
  flex: 0 0 auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: #efece6;
  color: #7a7266;
  font-size: 10.5px;
}
</style>
