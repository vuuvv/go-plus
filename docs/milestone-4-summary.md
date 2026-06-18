# 里程碑 4 工作文档：稳定性增强

## 完成功能范围

- 为 Go 测试文件 CodeLens provider 增加按文档版本和 parser 配置签名缓存的解析结果。
- 增加 CodeLens 刷新 debounce，文档编辑时合并高频刷新请求。
- 在保存 Go 测试文件、修改相关配置时主动失效缓存并刷新 CodeLens。
- 在 parser 返回诊断时写入 `Go Plus` output channel，保持编辑器里静默但给维护者留排查线索。
- 强化 `goPlus.runTest` 命令参数校验，避免从命令面板误触发时出现不清晰异常。
- 修复 `go test -run` 对 subtest 名称中字面量 `/` 和空白字符的处理，按 Go testing 的真实匹配名展开 pattern 段。
- 新增不支持模式 fixture，覆盖 helper 返回 table、变量驱动名称、循环内名称别名和动态 map key。
- 更新 parser、runner、CodeLens cache 相关测试，完整测试套件通过。

## 核心文件和模块

- `src/codelensCache.ts`：新增无 VSCode 依赖的解析缓存和 debounce 刷新调度器。
- `src/codelens.ts`：接入缓存、配置签名、诊断日志、刷新事件和资源释放。
- `src/extension.ts`：注册文档编辑、保存和配置变化监听，并强化 run target 校验。
- `src/runner.ts`：新增 `escapeGoTestRunSegment` 和 `rewriteGoTestName`，修复 `-run` pattern 中空白和斜杠名称的匹配。
- `test/codelensCache.test.ts`：覆盖缓存复用、失效、失败恢复和 debounce 行为。
- `test/runner.test.ts`：覆盖包含 `/`、`[]`、空格、引号和正则特殊字符的命令构造。
- `test/parser.test.ts`：新增不支持模式回归测试。
- `test/fixtures/parser/unsupported_patterns_test.go`：集中表达里程碑 4 的安全跳过场景。
- `test/fixtures/parser/table_cases_test.go`：补充包含 `/api/v1` 和 `[]` 的复杂静态 case 名称。

## 实现思路与设计取舍

- 缓存只按 `file` 保留最新解析结果，同一文件版本和同一 `nameFields` 签名复用 Promise。这能合并并发 CodeLens 请求，同时避免旧版本结果长期占用内存。
- 缓存失败后会自动删除对应条目。未完成编辑、Go helper 超时或环境异常不会污染后续重新解析。
- CodeLens 刷新事件使用 400ms debounce，落在产品建议的 300-500ms 范围内。保存和配置变化仍会触发失效，配置变化使用立即 flush。
- parser 输出的诊断只写入 output channel，不弹窗，不在编辑器里标红，避免用户正在输入半截 Go 代码时被打扰。
- `go test -run` 的实际执行继续使用 argv 数组，展示命令只用于 output channel 复现。这样 shell 引号不会影响实际执行。
- Go testing 会把 subtest 名称中的空白改写为 `_`，并把名称里的 `/` 视为测试路径层级。因此 runner 在构造 pattern 时先执行同等空白改写，再把包含 `/` 的 case 名称展开成多个 `-run` 段。
- 不支持模式继续采用“安全跳过”策略，不产出 `unsupported` CodeLens，也不弹用户提示，避免误导性入口。

## 已支持和明确不支持的模式

| 模式 | 当前行为 |
| --- | --- |
| 静态 keyed struct table | 显示 `Run Case` |
| 静态 positional struct table | 显示 `Run Case` |
| inline table literal | 显示 `Run Case` |
| `map[string]...` 静态 string key | 显示 `Run Case` |
| case 名称含空格、标点、正则特殊字符 | 正确构造 `-run` |
| case 名称含 `/` | 按 Go testing 路径规则展开为多个 `-run` 段 |
| helper 返回 table | 不显示 case 入口 |
| table entry 名称来自变量 | 不显示 case 入口 |
| `tt.name` 先赋值给局部变量再传给 `t.Run` | 不显示 case 入口 |
| 动态 map key 或 `fmt.Sprintf` 名称 | 不显示 case 入口 |
| nested subtests | 暂未建模，留到里程碑 5 之后评估 |

## 当前插件内可进行的操作

- 打开 Go `_test.go` 文件：在 Extension Development Host 中打开测试文件，插件会识别普通 `func TestXxx(t *testing.T)`，并对支持的 table case 生成 CodeLens。
- 点击 `Run Test`：运行整个测试函数，output channel 显示类似 `go test ./pkg -run '^TestName$'` 的命令和 Go 原始输出。
- 点击 `Run Case`：运行静态可解析的单个 table case，包含空格和 `/` 的名称会生成类似 `^url_path_$/^api$/^v1$` 的 pattern。
- 编辑测试文件：插件会清理对应文件缓存，并在 400ms debounce 后刷新 CodeLens。
- 保存测试文件：插件会失效该文件缓存并刷新 CodeLens。
- 修改配置：`goPlus.tableTests.enabled`、`nameFields`、`showFunctionRun`、`showCaseRun` 变化后会清空缓存并刷新入口。
- 查看诊断：当 Go 源码未完成或 parser 返回诊断时，可以在 `Go Plus` output channel 看到文件、位置和诊断信息；编辑器内不会弹窗。
- 安全忽略不支持模式：helper 返回 table、动态名称和无法静态回溯的名称不会显示 `Run Case`。

## 当前可进行操作

### 安装依赖

- 用途：恢复 TypeScript、ESLint 和 VSCode 类型依赖。
- 命令：`npm install`
- 预期结果：生成或更新 `node_modules`，后续编译和测试可运行。
- 失败优先检查：Node/npm 版本、网络访问、`package-lock.json` 是否被外部修改。

### 编译扩展

- 用途：验证 TypeScript 源码、VSCode API 类型和新增缓存模块。
- 命令：`npm run compile`
- 预期结果：`tsc -p ./` 通过，并在 `out` 目录生成编译产物。
- 失败优先检查：VSCode API 类型、显式返回类型、模块导入路径。

### 运行完整自动化测试

- 用途：验证 manifest、配置、parser、CodeLens 目标、缓存/debounce 和 runner 命令构造。
- 命令：`npm test`
- 预期结果：先编译，再通过 Node test 执行 `out/test/**/*.test.js`。当前通过 32 个断言。
- 失败优先检查：Go 工具链是否可用、helper fixture 是否被修改、`-run` pattern 断言是否符合 Go testing 规则。

### 运行 lint

- 用途：验证 TypeScript 代码风格和注释后的代码结构。
- 命令：`npm run lint`
- 预期结果：ESLint 无报错。
- 失败优先检查：未使用导入、回调类型、公开 API 返回类型。

### 启动 Extension Development Host

- 用途：手动验证 CodeLens、缓存刷新和运行命令。
- 入口：在 VSCode 打开本仓库，运行 `npm run compile` 后按 `F5`。
- 预期结果：打开 Go `_test.go` 文件后，测试函数位置出现 `Run Test`，可解析 table entry 位置出现 `Run Case`。
- 失败优先检查：Extension Host 是否加载本仓库、文件是否以 `_test.go` 结尾、`goPlus.tableTests.enabled` 是否为 `true`。

### 手动验证复杂 case 名称

- 用途：确认包含 `/`、`[]`、空格和正则字符的 case 可以精确运行。
- 入口：在 Extension Development Host 中打开包含类似 `url path /api/v1 [ok]` case 的 Go 测试文件，点击 `Run Case`。
- 预期结果：`Go Plus` output channel 展示的 `-run` pattern 会把空白改为 `_`，并把 `/api/v1` 展开为 `/^api$/^v1...$` 这样的 Go test 路径段，Go 只运行目标 case。
- 失败优先检查：Go 版本、测试函数是否实际使用 `t.Run(tt.name, ...)`，case 是否属于静态可解析模式。

### 手动验证不支持模式

- 用途：确认安全跳过策略不会产生误导性入口。
- 入口：使用 `test/fixtures/parser/unsupported_patterns_test.go` 中的模式创建或打开测试文件。
- 预期结果：函数级 `Run Test` 可显示，但 helper 返回 table、变量名称、别名名称和动态 map key 不显示 `Run Case`。
- 失败优先检查：fixture 是否被改成静态字面量、`goPlus.tableTests.showCaseRun` 是否开启、output channel 是否有 parser 诊断。

## 测试记录

- 日期：2026-06-18
- 命令：`npm test`
  - 结果：通过，Node test 运行 32 个断言，全部通过。
- 命令：`npm run lint`
  - 结果：通过，ESLint 未报告问题。
- 命令：`GO111MODULE=off go test ./test/fixtures/parser/table_cases_test.go -run '^TestKeyedNameTable$/^url_path_$/^api$/^v1_\[ok\]$' -v`
  - 结果：通过，Go 实际只运行 `TestKeyedNameTable/url_path_/api/v1_[ok]` 目标 subtest。

## 已知问题和后续计划

- 当前仍未实现 VSCode Testing API 测试树，等待里程碑 5 评估。
- 当前没有真正启动 Extension Development Host 的端到端自动化测试，仍以纯函数测试、TypeScript 编译和手动验证步骤保护集成入口。
- parser helper 仍通过 `go run` 启动。缓存和 debounce 已降低频率，但后续可评估预编译 helper 或长期进程。
- nested subtests 尚未建立完整 path 模型，后续需要决定如何与 CodeLens 和 Testing API 共享目标模型。
