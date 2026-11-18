import { onMounted, onUnmounted, ref } from 'vue';

/** 响应式媒体查询，返回随窗口变化更新的布尔 ref。 */
export function useMediaQuery(query: string) {
  const matches = ref(window.matchMedia(query).matches);
  let media: MediaQueryList | null = null;

  function update(event: MediaQueryListEvent): void {
    matches.value = event.matches;
  }

  onMounted(() => {
    media = window.matchMedia(query);
    matches.value = media.matches;
    media.addEventListener('change', update);
  });

  onUnmounted(() => {
    media?.removeEventListener('change', update);
  });

  return matches;
}
