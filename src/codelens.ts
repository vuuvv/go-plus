/**
 * Go table-driven test CodeLens provider。
 *
 * provider 负责把 parser 的结构化结果转换成 VSCode 编辑器里的运行入口：函数级入口锚定函数名，
 * case 级入口锚定 table entry。解析失败或用户正在输入不完整代码时只记录到 output channel，
 * 不在编辑器里制造噪声，符合产品对未完成编辑状态的容错要求。
 */

import * as vscode from 'vscode';
import { CodeLensParseCache, DebouncedCodeLensRefresh, parserConfigCacheKey } from './codelensCache';
import { commands, configurationKeys } from './constants';
import { createGoTestCodeLensTargets } from './codelensTargets';
import { GoHelperParser, isGoTestFile } from './parser';
import type { GoTestFileParseResult, GoTestParser, ParserDiagnostic, SourceRange } from './parser';
import { normalizeTableTestConfig, type TableTestConfig } from './tableTestConfig';

/** CodeLens provider 的依赖项，测试和后续缓存实现可以替换 parser/config。 */
export type GoTestCodeLensProviderOptions = {
  /** Go 测试文件 parser；默认使用 Go helper parser。 */
  parser?: GoTestParser;
  /** 读取当前配置的函数，默认从 VSCode workspace configuration 读取。 */
  getConfig?: () => TableTestConfig;
  /** 解析错误的记录目标，默认静默。 */
  output?: Pick<vscode.OutputChannel, 'appendLine'>;
  /** CodeLens 刷新的 debounce 时间，默认贴近产品建议的 300-500ms。 */
  debounceMs?: number;
  /** parser 结果缓存；测试可注入替身，真实扩展使用内置缓存。 */
  cache?: CodeLensParseCache<GoTestFileParseResult>;
};

/** 为 Go `_test.go` 文件提供 `Run Test` 和 `Run Case` CodeLens。 */
export class GoTestCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly parser: GoTestParser;
  private readonly getConfig: () => TableTestConfig;
  private readonly output?: Pick<vscode.OutputChannel, 'appendLine'>;
  private readonly cache: CodeLensParseCache<GoTestFileParseResult>;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly refreshScheduler: DebouncedCodeLensRefresh;

  /** VSCode 监听该事件后，会重新请求当前可见文档的 CodeLens。 */
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this.changeEmitter.event;

  /** 创建 provider；默认依赖适合真实扩展运行，options 主要服务自动化测试和后续缓存演进。 */
  public constructor(options: GoTestCodeLensProviderOptions = {}) {
    this.parser = options.parser ?? new GoHelperParser();
    this.getConfig = options.getConfig ?? readTableTestConfigFromWorkspace;
    this.output = options.output;
    this.cache = options.cache ?? new CodeLensParseCache<GoTestFileParseResult>();
    this.refreshScheduler = new DebouncedCodeLensRefresh(options.debounceMs ?? 400, () => {
      this.changeEmitter.fire();
    });
  }

  /**
   * 生成当前文档的运行 CodeLens。
   *
   * VSCode 会在打开、保存或编辑文档时调用该方法。这里每次读取 document 文本而不是磁盘文件，
   * 是为了支持未保存 buffer；helper parser 能在语法未完成时返回部分结果或诊断。
   */
  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    void token;
    const config = this.getConfig();
    const file = document.uri.fsPath;
    if (!config.enabled || !isGoTestFile(file)) {
      return [];
    }

    try {
      const result = await this.cache.getOrCreate(
        {
          file,
          version: document.version,
          parserConfigKey: parserConfigCacheKey(config)
        },
        async () => {
          const parser =
            this.parser instanceof GoHelperParser ? new GoHelperParser({ nameFields: config.nameFields }) : this.parser;
          const parseResult = await parser.parseTestFile(file, document.getText());
          this.logDiagnostics(file, parseResult.diagnostics);
          return parseResult;
        }
      );
      if (token.isCancellationRequested) {
        return [];
      }
      return createGoTestCodeLensTargets(result, config).map(target => {
        return new vscode.CodeLens(toVsCodeRange(target.range), {
          title: target.title,
          command: commands.runTest,
          arguments: [target.runTarget]
        });
      });
    } catch (error) {
      this.output?.appendLine(`Go Plus CodeLens parse failed for ${file}: ${String(error)}`);
      return [];
    }
  }

  /**
   * 标记单个文档需要重新解析，并 debounce 通知 VSCode 刷新 CodeLens。
   *
   * 文档变更时立即清理缓存，但延迟触发 UI 刷新，避免用户连续输入时让 helper parser 高频运行。
   */
  public refreshDocument(file: string): void {
    if (!isGoTestFile(file)) {
      return;
    }
    this.cache.invalidateFile(file);
    this.refreshScheduler.schedule();
  }

  /** 配置变化会影响所有文档，因此清理全量缓存并立即刷新。 */
  public refreshAll(): void {
    this.cache.clear();
    this.refreshScheduler.flush();
  }

  /** 释放 debounce timer、事件 emitter 和缓存。 */
  public dispose(): void {
    this.refreshScheduler.dispose();
    this.changeEmitter.dispose();
    this.cache.clear();
  }

  private logDiagnostics(file: string, diagnostics: ParserDiagnostic[]): void {
    if (diagnostics.length === 0) {
      return;
    }

    for (const diagnostic of diagnostics) {
      const position =
        typeof diagnostic.line === 'number'
          ? `:${diagnostic.line + 1}:${(diagnostic.character ?? 0) + 1}`
          : '';
      this.output?.appendLine(`Go Plus parser diagnostic ${file}${position}: ${diagnostic.message}`);
    }
  }
}

/** 从 VSCode 配置读取并归一化 table-driven test 选项。 */
export function readTableTestConfigFromWorkspace(): TableTestConfig {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeTableTestConfig({
    enabled: configuration.get(configurationKeys.enabled),
    nameFields: configuration.get(configurationKeys.nameFields),
    showFunctionRun: configuration.get(configurationKeys.showFunctionRun),
    showCaseRun: configuration.get(configurationKeys.showCaseRun)
  });
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}
