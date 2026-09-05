<template>
  <!-- 抽屉结构与类名沿用酒馆原生的 inline-drawer, 以保持外观一致 -->
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>UI 主题管理</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div class="flex-container flexFlowColumn flexGap5">
        <small>把你所有的 UI 主题排成一屏缩略图, 一眼就能看出长什么样.</small>
        <input class="menu_button" type="button" value="打开主题管理器" @click="emit('open')" />
      </div>
      <hr class="sysHR" />
    </div>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ open: [] }>();
</script>
