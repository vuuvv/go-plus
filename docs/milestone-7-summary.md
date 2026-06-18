# 里程碑 7 工作文档：当前文件测试树刷新 CodeLens

## 完成功能范围

- 新增命令 `goPlus.refreshCurrentFileTestTree`，在命令面板显示为 `Go Plus: Refresh Current File Test Tree`。
- 在 Go `_test.go` 文件顶部生成 `Refresh Test Tree` CodeLens。
- 点击顶部 CodeLens 时，只刷新当前文件对应的 `Go Plus Table Tests` 测试树节点。
- 命令面板执行时，如果没有传入文件路径，会从当前活动编辑器推断文件。
- 当前文件刷新复用 Testing API 单文件刷新逻辑，并优先使用已打开编辑器中的未保存文本。
- Testing API 未启用时，点击 CodeLens 或执行命令会提示开启 `goPlus.tableTests.testingApi.enabled`。
- 更新 manifest、命令常量和 CodeLens 目标生成测试。

## 核心文件和模块

- `src/constants.ts`：新增 `commands.refreshCurrentFileTestTree`。
- `package.json`：新增 `onCommand:goPlus.refreshCurrentFileTestTree` activation event 和命令贡献。
- `src/codelensTargets.ts`：新增顶部 `Refresh Test Tree` CodeLens 目标，锚定文件第 0 行第 0 列。
- `src/codelens.ts`：根据 CodeLens target 类型分发到 run 命令或当前文件刷新命令。
- `src/extension.ts`：注册当前文件刷新命令，并处理配置未开启、非 `_test.go` 文件和当前编辑器兜底。
- `src/testing.ts`：新增 `refreshFile`，打开或复用单个 Go 测试文件并刷新测试树节点。
- `test/codelensTargets.test.ts`：覆盖顶部刷新入口和原有运行入口。
- `test/constants.test.ts`、`test/manifest.test.ts`：覆盖新增命令契约。

## 实现思路与设计取舍

- 顶部 CodeLens 始终随 `_test.go` 文件解析生成，不额外增加配置项。即使 Testing API 未启用，也能引导用户开启实验测试树。
- 当前文件刷新不清空整个 workspace 测试树，只替换目标文件下的节点，避免打断其他文件的测试树状态。
- 命令面板入口和 CodeLens 入口复用同一个命令，CodeLens 传入文件路径，命令面板则使用当前活动编辑器。
- CodeLens 目标模型改成 union：`run` target 继续传给 runner，`refreshCurrentFileTestTree` target 传给刷新命令。
- 当前文件刷新仍复用 parser 和 Testing API tree model，不引入第二套识别逻辑。

## 当前插件内可进行的操作

- 启用实验测试树：设置 `goPlus.tableTests.testingApi.enabled` 为 `true`。
- 打开 Go `_test.go` 文件：文件顶部会出现 `Refresh Test Tree` CodeLens。
- 点击顶部 CodeLens：刷新当前文件在 Test Explorer 的 `Go Plus Table Tests` 节点。
- 执行命令面板命令：运行 `Go Plus: Refresh Current File Test Tree`，插件会从当前活动编辑器推断文件并刷新。
- 未启用 Testing API 时点击：插件会提示开启 `goPlus.tableTests.testingApi.enabled`，不会报错。
- 当前文件不是 `_test.go` 时执行命令：插件会提示先打开 Go 测试文件。
- 原有 `Run Test` 和 `Run Case` CodeLens 仍保持不变。

## 当前可进行操作

### 编译扩展

- 用途：验证新增 CodeLens command target 和当前文件刷新命令类型正确。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过。
- 失败优先检查：`GoTestCodeLensTarget` union 是否完整收窄、命令 ID 是否同步。

### 运行完整自动化测试

- 用途：验证 manifest、命令 ID、CodeLens target、parser、runner 和 Testing API 树模型。
- 命令：`npm test`
- 预期结果：当前通过 35 个断言。
- 失败优先检查：顶部 CodeLens 断言是否与目标生成顺序一致、manifest 命令贡献是否同步。

### 运行 lint

- 用途：验证新增命令和 CodeLens 分发逻辑的 TypeScript 风格。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：异步回调返回类型、未使用导入、union 分支是否写清。

### 手动刷新当前文件测试树

- 用途：确认顶部 CodeLens 只刷新当前文件对应测试树节点。
- 入口：启用 `goPlus.tableTests.testingApi.enabled`，打开 Go `_test.go` 文件，点击文件顶部 `Refresh Test Tree`。
- 预期结果：Test Explorer 中当前文件对应的 `TestXxx` 和 table case 节点被重建；其他文件节点不被全量清空。
- 失败优先检查：Testing API 是否启用、文件是否以 `_test.go` 结尾、`Go Plus` output channel 是否有 parser 诊断。

## 测试记录

- 日期：2026-06-18
- 命令：`npm test`
  - 结果：通过，Node test 运行 35 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。

## 已知问题和后续计划

- 当前没有 Extension Host e2e 自动化测试覆盖点击 CodeLens 后 Test Explorer 节点变化，仍需手动验证。
- 顶部刷新 CodeLens 暂无独立显示开关；如果后续用户认为噪声偏高，可增加配置项。
- Testing API 仍默认关闭；该 CodeLens 主要服务已启用实验测试树的开发者。
