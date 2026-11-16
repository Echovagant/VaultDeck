<template>
  <a-tree
    :tree-data="treeData"
    :selected-keys="selectedKeys"
    :expanded-keys="expandedKeys"
    block-node
    @select="onSelect"
    @expand="onExpand"
  />
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

interface FolderNode {
  folderId: string;
  folderName: string;
  parentId: string | null;
}

interface TreeNode {
  key: string;
  title: string;
  children?: TreeNode[];
}

const props = defineProps<{
  folders: FolderNode[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [folderId: string | null];
}>();

const expandedKeys = ref<string[]>([]);

const selectedKeys = computed(() => (props.selectedId ? [props.selectedId] : ['__all__']));

const treeData = computed<TreeNode[]>(() => {
  const byParent = new Map<string | null, FolderNode[]>();
  for (const folder of props.folders) {
    const list = byParent.get(folder.parentId) ?? [];
    list.push(folder);
    byParent.set(folder.parentId, list);
  }

  function build(parentId: string | null): TreeNode[] {
    return (byParent.get(parentId) ?? []).map((folder) => {
      const children = build(folder.folderId);
      const node: TreeNode = { key: folder.folderId, title: folder.folderName };
      if (children.length > 0) node.children = children;
      return node;
    });
  }

  return [{ key: '__all__', title: '全部资料', children: build(null) }];
});

function onSelect(keys: Array<string | number>): void {
  const key = String(keys[0] ?? '__all__');
  emit('select', key === '__all__' ? null : key);
}

function onExpand(keys: Array<string | number>): void {
  expandedKeys.value = keys.map((key) => String(key));
}

watch(
  () => props.folders,
  (folders) => {
    if (expandedKeys.value.length === 0) {
      expandedKeys.value = folders.map((folder) => folder.folderId);
    }
  },
  { immediate: true },
);
</script>
