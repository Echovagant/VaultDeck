<template>
  <el-container class="app-shell">
    <el-header class="app-header">
      <span class="app-title">VaultDeck</span>
    </el-header>
    <el-main>
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup lang="ts"></script>

<style scoped>
.app-shell {
  min-height: 100vh;
}

.app-header {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--el-border-color);
}

.app-title {
  font-size: 18px;
  font-weight: 600;
}
</style>
