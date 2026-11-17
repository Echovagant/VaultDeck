-- 修正 0006 的匹配写法：LIKE 中反斜杠是转义符，':\\%' 永远匹配不到。
-- 把历史绝对路径统一规范化为相对 dataRoot 的键（与 LocalObjectStorage.objectKey 一致）。
UPDATE stored_object
SET rel_path = 'objects/' || substr(sha256, 1, 2) || '/' || sha256 || '.bin'
WHERE rel_path ~ '^[A-Za-z]:[\\/]';
