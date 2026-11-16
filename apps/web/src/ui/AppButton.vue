<template>
  <el-button :type="type" :disabled="disabled" @click="emit('click')">
    <slot />
  </el-button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'default';
    disabled?: boolean;
  }>(),
  { type: 'default', disabled: false },
);

const emit = defineEmits<{ click: [] }>();
</script>
