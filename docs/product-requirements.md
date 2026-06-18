# Go Plus VSCode 插件产品需求文档

## 1. 产品概述

Go Plus 是一个用于增强官方 Go 开发体验的 VSCode 插件。当前阶段的核心目标是识别 Go 代码中的 table-driven tests，准确定位每一个测试用例，并在编辑器中展示可直接运行的按钮。

这个插件应当自然融入 Go 开发者已有的工作方式：编写测试、看到可运行标记、运行整个测试函数或单个表格用例，并在测试失败时快速跳转到对应用例。

## 2. 背景

table-driven tests 是 Go 项目中非常常见的测试写法，但编辑器支持通常只停留在测试函数级别。开发者如果只想运行表格中的某一个 case，往往需要手动修改代码、拼接 `go test -run` 参数，或者复制测试名称。

本项目希望让 table-driven tests 中的单个 case 成为 VSCode 里的一等可运行对象。

## 3. 产品目标

- 高置信度识别 Go 文件中的 table-driven tests。
- 将每个可运行测试 case 定位到最有用的源码位置。
- 在编辑器中为每个已识别 case 显示运行按钮。
- 复用 Go 标准工具链，不替代官方 Go 插件。
- 为后续调试、覆盖率、VSCode Testing API 集成留下清晰扩展点。

## 4. 当前阶段非目标

- 不替代官方 Go 插件。
- 不实现自定义 Go 测试运行器。
- 不支持所有动态生成或运行时构造的 table case。
- 不自动修改用户源码。
- 不做跨 package 的复杂测试编排。
- 不在验证 CodeLens 或编辑器内运行按钮之前，先构建完整自定义测试面板。

## 5. 目标用户

- 经常编写 table-driven tests 的 Go 后端工程师。
- 维护大量 Go 测试用例的大型项目开发者。
- 以 VSCode 和官方 Go 插件为主要开发环境的团队。

## 6. 用户痛点

- 运行整个测试函数很容易，运行其中一个 table case 很麻烦。
- `t.Run` 子测试在源码中可见，但编辑器中不一定有对应的运行入口。
- 大型 table test 失败后，需要人工查找对应 case。
- 手写 `go test -run` 过滤表达式繁琐且容易出错。
- 编辑器可能只在 `TestXxx` 函数上显示运行按钮，不支持表格中的单个 case。

## 7. 核心用户故事

- 作为 Go 开发者，我希望在每个可识别的 table case 旁边看到运行按钮，这样可以不修改代码直接运行它。
- 作为 Go 开发者，我希望在整个 table-driven test 函数旁边看到运行按钮，这样可以一次运行全部 case。
- 作为 Go 开发者，我希望插件把 table case 定位到最能代表该 case 的源码位置，比如表格条目或 `t.Run` 调用。
- 作为 Go 开发者，我希望动态或不支持的 case 能被安全忽略，而不是显示可能运行错误测试的按钮。
- 作为 Go 开发者，我希望插件生成的命令遵循标准 `go test` 行为，从而兼容已有项目。

## 8. 第一阶段范围

### 8.1 测试函数识别

插件必须识别以下常规 Go 测试函数：

```go
func TestName(t *testing.T) {
    // ...
}
```

识别要求：

- 函数名以 `Test` 开头。
- 第一个参数兼容 `*testing.T`。
- 文件是 Go 测试文件，通常以 `_test.go` 结尾。
- 第一阶段暂不主动支持 benchmark 和 fuzz test；除非其中包含后续可安全处理的普通 subtest。

### 8.2 table-driven 模式识别

插件应识别常见 table-driven test 模式：

```go
tests := []struct {
    name string
    input string
    want string
}{
    {name: "empty", input: "", want: ""},
    {name: "simple", input: "a", want: "a"},
}

for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        // assertions
    })
}
```

第一阶段必须支持：

- 测试函数内部声明的本地 table 变量。
- 使用 struct entry 的 composite literal table。
- table entry 中包含稳定字符串字段，例如 `name`、`desc`、`caseName`、`title`。
- `for range` 遍历 table 变量。
- `t.Run(<case name expression>, func(t *testing.T) { ... })`。
- case name expression 可以从 range 变量字段解析，例如 `tt.name`。

第一阶段可选支持，前提是实现成本较低：

- 在 `range` 表达式中直接使用 inline table literal。
- 当字段顺序可以从 struct 定义安全解析时，支持 positional struct value。
- 使用字符串 map key 作为 subtest 名称的 map-based table。

第一阶段明确不支持：

- 通过运行时数据、`fmt.Sprintf`、非字面量拼接或 helper function 生成的 case name。
- 从文件加载、运行时生成、或由 helper function 返回的 table。
- 多个 table 变量和 range 变量导致映射关系不明确的场景。
- 针对 parallel subtest 做额外调度控制；执行行为只遵循标准 `go test`。

### 8.3 源码定位要求

每个已识别的可运行目标必须产出：

- 文件 URI。
- 起始行号和字符位置。
- 可用时提供结束行号和字符位置。
- 展示标签。
- 所属测试函数名。
- 可用时提供已解析的 subtest path。
- 置信度：`exact`、`probable` 或 `unsupported`。

定位优先级：

1. 如果 case name 声明在 table entry 中，优先定位到 table entry。
2. 如果无法映射到 table entry，但 subtest 名称是静态可知的，则定位到 `t.Run` 调用。
3. 整个测试函数的运行入口定位到测试函数声明。

### 8.4 可运行入口

插件必须为以下目标显示运行入口：

- 整个 Go 测试函数。
- 当 subtest 名称可以精确解析时，显示单个 table case 的运行入口。

第一阶段可接受的 UI 形式：

- 测试函数上方的 CodeLens。
- table case 上方或旁边的 CodeLens。
- 如果实现成本可控，也可以接入 VSCode Testing API。

初始命令行为：

```sh
go test ./path/to/package -run '^TestName$/^case name$'
```

命令生成要求：

- 正确转义测试名和 subtest 名称中的正则特殊字符。
- 保留 subtest 名称中的空格和标点符号。
- 使用当前文件所属 package 目录。
- 以 workspace root 作为命令运行上下文。
- 将命令输出展示到 VSCode output channel 或 terminal。

### 8.5 错误处理

- 如果 table case 无法安全解析，不显示 case 级别运行入口。
- 如果无法确定 package path，显示清晰错误信息。
- 如果 `go test` 执行失败，保留原始输出，方便开发者排查。
- 如果代码处于未完成编辑状态导致解析失败，不产生噪声错误，并在文档变更后重试。

## 9. 产品行为细节

### 9.1 标签

推荐标签：

- 函数级入口：`Run Test`
- case 级入口：`Run Case`
- 后续可选调试入口：`Debug Case`

展示名示例：

- `TestNormalize`
- `TestNormalize/empty`
- `TestNormalize/simple`

### 9.2 刷新触发

插件应在以下时机刷新识别结果：

- 打开 Go 测试文件。
- 保存 Go 测试文件。
- 当前活动文本编辑器变化。
- Go 测试文件被编辑，并使用 debounce 避免过度解析。

推荐 debounce 时间：300-500ms。

### 9.3 配置项

第一阶段配置：

```json
{
  "goPlus.tableTests.enabled": true,
  "goPlus.tableTests.nameFields": ["name", "desc", "caseName", "title"],
  "goPlus.tableTests.showFunctionRun": true,
  "goPlus.tableTests.showCaseRun": true
}
```

后续可扩展配置：

```json
{
  "goPlus.tableTests.runInTerminal": true,
  "goPlus.tableTests.extraGoTestArgs": [],
  "goPlus.tableTests.packagePattern": "directory"
}
```

## 10. 技术要求

### 10.1 架构建议

推荐模块：

- `extension`：VSCode 激活、命令注册、生命周期管理。
- `parser`：Go 源码解析和 AST 提取。
- `detector`：table-driven test 识别。
- `locator`：源码 range 映射。
- `runner`：`go test` 命令构造与执行。
- `codelens`：编辑器运行入口提供者。
- `testing`：可选的 VSCode Testing API 集成。

### 10.2 解析策略

优先策略：

- 使用支持 Go 语法且能提供源码位置的 parser。
- 保留足够 AST 信息，用于把 table entry 和 `t.Run` 调用映射回准确编辑器 range。
- 核心识别逻辑避免仅靠正则表达式。

可接受实现方案：

- 如果准确性和维护性可接受，使用 TypeScript 兼容的 Go parser。
- 调用一个小型 Go helper binary，内部使用 `go/parser`、`go/ast`、`go/token`。
- 先建立 parser 抽象，便于后续切换实现，而不影响 UI 层。

第一阶段推荐方向：

- 如果 TypeScript parser 质量不足，优先实现 Go helper 负责 AST 提取。
- helper 以结构化 JSON 返回结果给 VSCode extension。

### 10.3 识别数据模型

建议内部数据结构：

```ts
type TableTestCase = {
  id: string;
  label: string;
  file: string;
  packageDir: string;
  testName: string;
  subtestName: string;
  runPattern: string;
  range: SourceRange;
  confidence: "exact" | "probable";
};
```

### 10.4 运行表达式构造

runner 必须生成兼容 Go subtest 选择规则的正则路径：

```text
^TestName$/^SubtestName$
```

对于后续 nested subtests，应扩展为：

```text
^TestName$/^ParentCase$/^ChildCase$
```

所有来自用户源码的名称都必须按正则字面量转义。

### 10.5 代码注释要求

项目代码必须保持完整、清晰、可维护的注释体系。注释不是为了重复代码本身，而是为了说明模块职责、核心算法、边界条件、设计取舍和容易误解的行为。

必须添加注释的位置：

- 每个公开导出的函数、类型、接口、命令和配置项。
- parser、detector、locator、runner 等核心模块的入口方法。
- table-driven test 识别算法中的关键分支，例如 table 变量解析、range 变量映射、`t.Run` 参数解析、case name 回溯。
- 正则转义、Go test run pattern 构造、路径解析等容易出现细节错误的逻辑。
- 对不支持模式做出跳过判断的位置，必须说明为什么跳过。
- 异步流程、缓存、debounce、child process 调用等影响 VSCode extension host 稳定性的逻辑。
- 测试 fixture 中用于表达特殊场景的代码，必须说明该 fixture 覆盖的模式。

注释规范：

- 注释使用中文，必要的 API 名称、配置键、命令和代码标识符保留英文。
- 注释应解释“为什么这样做”和“这个分支保护了什么场景”，避免只复述代码。
- 修改已有逻辑时，应同步更新相关注释，禁止让注释与实际行为不一致。
- 对于复杂模块，应在文件顶部提供模块级注释，说明输入、输出、核心约束和不支持范围。

### 10.6 工作文档要求

每个里程碑或重要功能完成后，必须在 `docs` 目录下补充或更新工作文档，作为后续维护和进度追踪依据。

工作文档必须包含：

- 本次完成的功能范围。
- 涉及的核心文件和模块。
- 关键实现思路与重要设计取舍。
- 已支持的测试模式和明确不支持的模式。
- 已执行的测试命令、测试结果和未覆盖风险。
- 当前项目现阶段可以进行的操作，包括构建、测试、启动 Extension Development Host、运行示例命令、调试入口和手动验证步骤。
- 当前插件内用户可以进行的操作，包括能看到哪些 VSCode 入口、能点击哪些命令、运行后在哪里查看结果、哪些配置会影响行为，以及哪些场景会被安全忽略。
- 已知问题、后续计划和待确认问题。

建议文档命名：

- 里程碑总结：`docs/milestone-<number>-summary.md`
- 功能说明：`docs/feature-<feature-name>.md`
- 技术决策记录：`docs/adr-<number>-<topic>.md`

文档语言要求：

- 面向项目维护者，默认使用中文。
- 技术名词、命令、配置项、文件路径和代码标识符保留英文原文。
- 文档必须随着实现同步更新，不允许功能完成但缺少对应工作文档。

每次任务完成后的里程碑文档更新要求：

- 必须更新对应里程碑文档中的“当前可进行操作”章节。
- 必须维护“当前插件内可进行的操作”或同等章节，面向使用者说明插件当前真实可用的交互能力。
- 如果本次任务新增、修改或废弃了任何命令、脚本、运行方式、调试方式或验证步骤，必须同步写入里程碑文档。
- “当前可进行操作”必须反映项目当前真实可执行的能力，不能提前写入尚未实现或尚未验证的功能。
- “当前插件内可进行的操作”必须只记录已经实现并验证过的插件内能力；如果能力需要 Extension Development Host、Go 工具链、特定 fixture 或特定配置才可使用，必须写明前置条件。
- 每个操作必须包含用途、执行命令或入口、预期结果，以及失败时优先检查的方向。
- 如果某项能力当前不能运行，也应在里程碑文档中说明原因和恢复条件。

### 10.7 测试覆盖要求

测试必须覆盖 parser、detector、locator、runner 和 VSCode 集成入口的关键行为。项目默认不接受只有手动验证、缺少自动化测试的核心功能变更。

单元测试必须覆盖：

- 测试函数识别。
- table 变量识别。
- keyed struct literal case 解析。
- positional struct literal case 解析。
- inline table literal 解析。
- map-based table 解析。
- `for range` 变量映射。
- `t.Run` 参数解析。
- case name 字段回溯。
- 动态 case name 的安全跳过。
- source range 定位。
- `go test -run` pattern 构造。
- 正则特殊字符转义。
- package 目录解析。
- 配置项启用、禁用和默认值行为。

集成测试或端到端测试应覆盖：

- 打开 `_test.go` 文件后生成 CodeLens。
- 点击函数级运行入口后执行目标测试函数。
- 点击 case 级运行入口后只执行目标 case。
- 文件编辑后识别结果刷新。
- 不支持模式不显示误导性运行入口。

测试质量要求：

- 每个新增支持模式必须有对应 fixture。
- 每个 bug 修复必须补充回归测试。
- 测试命名必须能表达被覆盖的行为。
- 测试断言必须验证关键输出，而不是只验证“不报错”。
- 阶段性交付前必须运行完整测试套件，并将测试结果记录到对应工作文档中。

### 10.8 Git 提交要求

每次任务完成后，必须生成标准、清晰、带类型和 scope 前缀的 git commit 信息并提交代码，确保实现、测试、文档和需求变更可以被追踪。

提交要求：

- 提交前必须检查 `git status`，确认本次提交只包含当前任务相关变更。
- 提交前必须执行与本次变更匹配的验证命令，并在回复或工作文档中记录结果。
- commit message 必须使用 `type(scope): summary` 格式，例如 `docs(product-requirements): 补充里程碑可操作清单要求`。
- `type` 用于说明变更类别，常见值包括 `feat`、`fix`、`docs`、`test`、`refactor`、`chore`。
- `scope` 用于说明影响范围，应尽量使用模块名、文档名或功能名，例如 `product-requirements`、`parser`、`runner`、`codelens`。
- `summary` 使用简洁明确的中文动词短语，说明本次提交的核心意图。
- 不允许使用缺少前缀的提交信息，例如 `补充需求`、`更新文档`。
- 当任务包含产品需求、工作文档或测试记录变更时，应与实现代码一起提交，避免文档和代码脱节。
- 如果存在用户未要求的外部改动，必须保留这些改动，不得擅自回滚；提交时只纳入本次任务需要的文件。

## 11. UX 要求

- 打开文件后，运行入口应尽快出现。
- 当官方 Go 插件已经提供函数级运行按钮时，应避免重复造成噪声；或者允许用户通过配置控制。
- case 级运行入口应尽量靠近对应 table entry。
- 不支持的 case 不应在编辑器里显示警告或干扰信息。
- 只有在用户触发运行或环境明显配置错误时，才显示错误信息。

## 12. 验收标准

第一阶段完成需满足：

- 插件可以在包含 Go 文件的 VSCode workspace 中激活。
- 包含常规 table-driven test 的 `_test.go` 文件能显示可运行入口。
- 点击整个测试函数入口时，可以运行目标测试函数。
- 点击已识别 case 入口时，只运行该 case。
- 带空格、斜杠、标点和正则特殊字符的名称能被安全处理。
- 当 case name 声明在 table entry 中时，运行入口定位到 table entry。
- 不支持的动态 case 不显示误导性运行入口。
- parser 和 runner 行为有单元测试覆盖。
- 至少三个 fixture 文件覆盖常见 table-driven 模式。
- 核心代码具有完整中文注释，能够解释模块职责、关键算法和边界条件。
- 本阶段完成后，`docs` 目录下有对应工作文档记录实现范围、测试结果和后续计划。
- 每次任务完成后，对应里程碑文档已更新“当前可进行操作”，并能指导维护者执行当前阶段真实可用的构建、测试、运行、调试和验证流程。
- 自动化测试覆盖所有已支持模式、主要不支持模式和关键命令构造逻辑。

## 13. 质量标准

准确性：

- 不允许已知 false positive 导致运行错误 case。
- 面对难以静态解析的动态 case，宁可不显示入口，也不要显示错误入口。

性能：

- 在现代笔记本上，解析普通测试文件应低于 100ms。
- 解析和测试执行不能阻塞 VSCode extension host。

可靠性：

- 能处理未保存或编辑到一半的文件，不崩溃。
- `go test` 失败时，输出内容仍然清晰可读。

可维护性：

- 识别逻辑必须由 fixture 驱动。
- 每个已支持模式都应有命名明确的测试 fixture。
- 命令构造必须独立于解析逻辑进行测试。
- 核心模块必须有模块级注释，公开 API 必须有用途说明。
- 复杂逻辑必须通过注释说明设计原因、边界条件和失败策略。
- 每次重要功能交付必须同步更新 `docs` 下的工作文档。
- 每次任务完成后，里程碑文档必须同步更新当前可执行操作清单，确保项目状态、命令和验证路径可追踪。
- 新增能力必须同时包含正向测试、边界测试和不支持场景测试。

## 14. 开发里程碑

### 里程碑 0：项目骨架

- 初始化 VSCode extension 项目。
- 添加 TypeScript build、lint 和 test 配置。
- 注册 Go 测试文件相关 activation events。
- 添加基础 output channel。
- 建立代码注释规范和工作文档模板。

退出标准：

- 插件可以在 VSCode Extension Development Host 中启动。
- 可以执行一个 no-op command。
- `docs` 目录下存在项目骨架阶段工作文档。
- 基础测试命令可以运行，并有结果记录。
- 里程碑文档包含当前可进行操作，例如安装依赖、构建、运行测试、启动 Extension Development Host。

### 里程碑 1：parser 方案验证

- 评估 parser 实现策略。
- 将 `_test.go` 文件解析成结构化测试函数元数据。
- 将 Go token position 映射为 VSCode range。
- 为 parser 关键入口和位置映射逻辑添加完整注释。

退出标准：

- fixture 中的测试函数可以被识别，并带有源码 range。
- parser 单元测试覆盖正常函数、非测试函数和语法未完成文件。
- `docs` 目录下记录 parser 方案取舍和测试结果。
- 里程碑文档更新当前可进行操作，例如如何运行 parser 测试、如何查看 fixture 解析输出。

### 里程碑 2：table case 识别

- 识别本地 table 变量。
- 解析 `for range` 变量映射关系。
- 将 `t.Run(tt.name, ...)` 解析到 table entry。
- 产出带置信度的 case 元数据。
- 为 table 识别算法和不支持模式判断添加完整注释。

退出标准：

- 常见 table-driven fixtures 能产出准确 case 位置。
- detector 和 locator 测试覆盖已支持模式、边界模式和不支持模式。
- `docs` 目录下记录已支持模式矩阵和未支持原因。
- 里程碑文档更新当前可进行操作，例如如何运行 detector 测试、如何验证 case 定位结果。

### 里程碑 3：CodeLens 运行入口

- 添加 Go 测试文件 CodeLens provider。
- 展示函数级和 case 级运行入口。
- 实现 `go test -run` 命令构造。
- 在 terminal 或 output channel 中执行命令。
- 为 CodeLens provider、命令参数构造和执行流程添加完整注释。

退出标准：

- 用户可以从编辑器中运行已识别的单个 test case。
- runner 测试覆盖空格、斜杠、标点和正则特殊字符。
- `docs` 目录下记录运行入口行为、执行方式和测试结果。
- 里程碑文档更新当前可进行操作，例如如何启动插件、如何点击 CodeLens、如何验证 `go test -run` 命令。

### 里程碑 4：稳定性增强

- 支持复杂名称转义。
- 添加错误处理和用户提示。
- 添加 debounce 和缓存失效逻辑。
- 添加不支持模式的 fixture。
- 更新所有受影响模块注释和工作文档。

退出标准：

- 对已知不支持模式不会显示误导性入口。
- 完整测试套件通过，并在工作文档中记录结果。
- 回归测试覆盖本阶段修复或新增的边界场景。
- 里程碑文档更新当前可进行操作，例如如何运行完整测试套件、如何手动验证不支持模式。

### 里程碑 5：VSCode Testing API 评估

- 原型验证测试树集成。
- 比较 Testing API UX 与纯 CodeLens UX 的差异。
- 决定 v0.1 是否包含 Testing API，或延后到后续版本。
- 记录 Testing API 原型代码的注释和验证范围。

退出标准：

- 记录决策和取舍。
- `docs` 目录下有 Testing API 评估文档，包含测试结果和最终建议。
- 里程碑文档更新当前可进行操作，例如如何启用或查看 Testing API 原型、如何复现评估结果。

### 里程碑 6：项目级测试树刷新

- 添加命令或按钮，允许用户主动重新扫描整个 workspace 并生成 Go Plus 测试树。
- 将刷新能力接入 VSCode Test Explorer 的 Testing API refresh 入口。
- 扫描未打开的 `_test.go` 文件，并优先使用已打开文档的未保存内容。
- 刷新时清理旧测试树，避免删除、重命名或不再可解析的文件残留过期节点。
- 为命令 ID、manifest 贡献和刷新流程添加注释、测试和工作文档。

退出标准：

- 用户可以通过命令面板执行 `Go Plus: Refresh Test Tree` 重新生成测试树。
- 启用 Testing API 原型后，用户可以通过 Test Explorer refresh 按钮重新扫描整个项目。
- 未打开的 `_test.go` 文件也能出现在 Go Plus 测试树中。
- Testing API 关闭时，刷新命令给出清晰提示，不产生异常。
- 完整测试套件通过，并在工作文档中记录结果。
- 里程碑文档更新当前可进行操作，例如如何启用 Testing API、如何执行项目级刷新、如何排查未显示文件。

### 里程碑 7：当前文件测试树刷新 CodeLens

- 在 Go `_test.go` 文件顶部添加 CodeLens，允许用户刷新当前文件对应的 Testing API 测试树节点。
- 添加命令 `goPlus.refreshCurrentFileTestTree`，支持 CodeLens 传入文件路径，也支持命令面板从当前编辑器推断文件。
- 当前文件刷新应复用 Testing API 单文件刷新逻辑，并优先使用未保存编辑器内容。
- Testing API 未启用时，点击 CodeLens 或命令应给出清晰提示，不产生异常。
- 更新 manifest、CodeLens 目标生成测试、命令常量测试和工作文档。

退出标准：

- 打开 Go `_test.go` 文件后，文件顶部出现 `Refresh Test Tree` CodeLens。
- 点击该 CodeLens 只刷新当前文件在 `Go Plus Table Tests` 中的节点。
- 当前文件不是 `_test.go` 或 Testing API 未启用时，用户看到清晰提示。
- 完整测试套件通过，并在工作文档中记录结果。
- 里程碑文档更新当前可进行操作，例如如何点击顶部 CodeLens 刷新当前文件测试树。

## 15. 测试 fixture 计划

必备 fixtures：

- 基础 `name` 字段 table。
- 使用 `desc` 字段的 table。
- 名称包含空格。
- 名称包含正则特殊字符。
- 使用 keyed struct literals 的 table entries。
- 使用 positional struct literals 的 table entries。
- `range` 表达式中直接使用 inline table literal。
- map-based table。
- 使用 `fmt.Sprintf` 生成动态名称的不支持案例。
- 使用 helper function 生成名称的不支持案例。
- nested subtests，标记为 future 或 experimental。

## 16. 风险与应对

风险：TypeScript 生态中的 Go parser 对语法支持不完整。

应对：将 parser 封装在接口后面，允许切换到 Go helper 实现。

风险：`go test -run` 路径转义容易出现细节错误。

应对：建立独立 escaping 模块，并为所有特殊字符编写单元测试。

风险：与官方 Go 插件 UI 重复，造成编辑器噪声。

应对：将函数级入口做成可配置项，优先突出 case 级能力。

风险：动态 table case 无法静态解析。

应对：引入置信度模型，无法安全解析时不显示运行入口。

风险：大文件导致编辑器操作变慢。

应对：使用 debounce、按 document version 缓存，并避免同步 child process。

## 17. 待确认问题

- 第一阶段是否依赖官方 Go 插件已安装，还是完全独立运行？
- 测试执行应该使用 VSCode terminal、output channel，还是两者都支持？
- 当 table entry 和 `t.Run` 位置都可用时，case 运行入口应该显示在哪一个位置，还是两处都显示？
- 第一阶段是否包含 debug action，还是留到 v0.2？
- 对于 `probable` 级别的 case，是否允许通过 experimental 设置显示？

## 18. v0.1 建议定义

v0.1 应在以下能力稳定后发布：开发者打开一个常见 Go table-driven test 文件后，可以看到静态命名 case 的运行入口，点击后能用标准 `go test` 可靠地只运行该 case。

v0.1 的产品承诺应保持窄而扎实：无需修改源码，就能直接运行 table-driven tests 中的单个 case。
