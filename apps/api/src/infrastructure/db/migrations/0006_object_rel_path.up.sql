-- 存储对象路径规范化：历史行存的是安装机绝对路径，迁移到相对 dataRoot 的键。
-- 键格式与 LocalObjectStorage.objectKey 一致：objects/<sha 前两位>/<sha>.bin
-- 注意：LIKE 里反斜杠是转义符，这里用正则匹配盘符，避免 ':\\%' 永远不命中。
UPDATE stored_object
SET rel_path = 'objects/' || substr(sha256, 1, 2) || '/' || sha256 || '.bin'
WHERE rel_path ~ '^[A-Za-z]:[\\/]';
