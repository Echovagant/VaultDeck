<template>
  <a-button :type="type" :disabled="disabled" @click="emit('click')">
    <slot />
  </a-button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    type?: 'default' | 'primary' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }>(),
  { type: 'default', disabled: false },
);

const emit = defineEmits<{ click: [] }>();
</script>
