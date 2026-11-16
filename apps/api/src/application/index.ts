/**
 * 应用层：用例编排与事务边界。
 * 只允许依赖 domain 与 ports 中的接口，不得引用框架与 infrastructure。
 */
export const APPLICATION_LAYER = 'application';
