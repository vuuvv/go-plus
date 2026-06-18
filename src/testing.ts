/**
 * VSCode Testing API 实验原型。
 *
 * 该模块把 parser 识别出的 Go test/table case 映射到 VSCode Test Explorer。它是里程碑 5 的评估
 * 原型，默认由配置关闭：v0.1 仍以 CodeLens 作为主入口，Testing API 只用于比较测试树 UX、复用
 * runner 目标模型，并验证后续接入成本。
 */

import * as vscode from 'vscode';
import { parserConfigCacheKey } from './codelensCache';
import { readTableTestConfigFromWorkspace } from './codelens';
import { GoHelperParser, isGoTestFile } from './parser';
import type { GoTestFileParseResult, GoTestParser, SourceRange } from './parser';
import { runGoTestTarget, type GoTestRunTarget } from './runner';
import { createGoTestTreeNodes, type GoTestTreeNode } from './testingTargets';
import type { TableTestConfig } from './tableTestConfig';

const controllerId = 'go-plus.tableTests';
const controllerLabel = 'Go Plus Table Tests';
const goTestFilePattern = '**/*_test.go';
const ignoredTestFilePattern = '**/{.git,node_modules,out}/**';

/** Testing API 原型依赖项，测试或后续集成可以替换 parser/config。 */
export type GoPlusTestingApiPrototypeOptions = {
  /** VSCode output channel，用于复用 runner 输出和记录 parser 诊断。 */
  output: vscode.OutputChannel;
  /** Go 测试文件 parser，默认使用 Go helper。 */
  parser?: GoTestParser;
  /** 读取当前配置的函数，默认从 VSCode workspace configuration 读取。 */
  getConfig?: () => TableTestConfig;
};

type RegisteredTestItem = {
  item: vscode.TestItem;
  target: GoTestRunTarget;
};

/**
 * 管理实验性 `TestController` 的生命周期。
 *
 * 开关关闭时不创建 controller，避免 Test Explorer 出现空的 Go Plus 树；开关打开后会刷新当前已打开
 * 的 Go 测试文件，并在后续文档事件中增量更新。
 */
export class GoPlusTestingApiPrototypeManager implements vscode.Disposable {
  private prototype: GoPlusTestingApiPrototype | undefined;

  public constructor(private readonly options: GoPlusTestingApiPrototypeOptions) {}

  /** 按配置启用或停用 Testing API 原型。 */
  public setEnabled(enabled: boolean): void {
    if (enabled && !this.prototype) {
      this.prototype = new GoPlusTestingApiPrototype(this.options);
      for (const document of vscode.workspace.textDocuments) {
        this.refreshDocument(document);
      }
      return;
    }

    if (!enabled && this.prototype) {
      this.prototype.dispose();
      this.prototype = undefined;
    }
  }

  /** 刷新单个文档对应的测试树；关闭时忽略事件。 */
  public refreshDocument(document: vscode.TextDocument): void {
    void this.prototype?.refreshDocument(document);
  }

  /** 打开或复用指定 Go 测试文件，并只刷新该文件对应的测试树节点；关闭时返回 false。 */
  public async refreshFile(file: string): Promise<boolean> {
    if (!this.prototype) {
      return false;
    }
    return await this.prototype.refreshFile(file);
  }

  /** 扫描 workspace 中所有 Go 测试文件并重建实验测试树；关闭时返回 0。 */
  public async refreshWorkspace(): Promise<number> {
    if (!this.prototype) {
      return 0;
    }
    return await this.prototype.refreshWorkspace();
  }

  /** 释放当前 controller。 */
  public dispose(): void {
    this.prototype?.dispose();
    this.prototype = undefined;
  }
}

class GoPlusTestingApiPrototype implements vscode.Disposable {
  private readonly controller: vscode.TestController;
  private readonly parser: GoTestParser;
  private readonly getConfig: () => TableTestConfig;
  private readonly output: vscode.OutputChannel;
  private readonly registeredItems = new Map<string, RegisteredTestItem>();
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(options: GoPlusTestingApiPrototypeOptions) {
    this.output = options.output;
    this.parser = options.parser ?? new GoHelperParser();
    this.getConfig = options.getConfig ?? readTableTestConfigFromWorkspace;
    this.controller = vscode.tests.createTestController(controllerId, controllerLabel);
    this.controller.refreshHandler = async (token): Promise<void> => {
      await this.refreshWorkspace(token);
    };
    this.disposables.push(this.controller);
    this.disposables.push(
      this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, request => {
        void this.runTests(request);
      })
    );
  }

  /**
   * 解析文档并重建对应文件的测试树。
   *
   * 原型阶段按文件整棵替换，逻辑简单且便于评估；后续若默认启用 Testing API，再考虑更细粒度 diff。
   */
  public async refreshDocument(document: vscode.TextDocument): Promise<void> {
    const file = document.uri.fsPath;
    if (!isGoTestFile(file)) {
      return;
    }

    const config = this.getConfig();
    if (!config.enabled || !config.testingApiEnabled) {
      this.removeFileItems(file);
      return;
    }

    try {
      const parser =
        this.parser instanceof GoHelperParser ? new GoHelperParser({ nameFields: config.nameFields }) : this.parser;
      const parseResult = await parser.parseTestFile(file, document.getText());
      this.outputDiagnostics(file, parseResult);
      this.replaceFileItems(document.uri, file, createGoTestTreeNodes(parseResult, config));
    } catch (error) {
      this.output.appendLine(`Go Plus Testing API parse failed for ${file}: ${String(error)}`);
      this.removeFileItems(file);
    }
  }

  /** 只刷新一个 Go 测试文件，供顶部 CodeLens 和命令面板入口复用。 */
  public async refreshFile(file: string): Promise<boolean> {
    if (!isGoTestFile(file)) {
      return false;
    }

    const document = await openWorkspaceDocument(vscode.Uri.file(file));
    await this.refreshDocument(document);
    this.output.appendLine(`Go Plus Testing API refresh: refreshed current file ${file}.`);
    return true;
  }

  /**
   * 重新扫描整个 workspace 并刷新测试树。
   *
   * 这个入口同时服务命令面板命令和 Test Explorer 的 refresh 按钮。扫描会读取未打开的 `_test.go`
   * 文件；如果某个文件已经在编辑器中打开，则优先使用内存中的未保存文本，避免测试树落后于用户编辑。
   */
  public async refreshWorkspace(token?: vscode.CancellationToken): Promise<number> {
    const config = this.getConfig();
    if (!config.enabled || !config.testingApiEnabled) {
      this.clearAllItems();
      return 0;
    }

    const uris = await vscode.workspace.findFiles(goTestFilePattern, ignoredTestFilePattern);
    this.output.appendLine(`Go Plus Testing API refresh: scanning ${uris.length} Go test file(s).`);
    this.clearAllItems();

    let refreshed = 0;
    for (const uri of uris) {
      if (token?.isCancellationRequested) {
        break;
      }
      const document = await openWorkspaceDocument(uri);
      await this.refreshDocument(document);
      refreshed++;
    }

    this.output.appendLine(`Go Plus Testing API refresh: refreshed ${refreshed} Go test file(s).`);
    return refreshed;
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    this.registeredItems.clear();
  }

  private replaceFileItems(uri: vscode.Uri, file: string, nodes: GoTestTreeNode[]): void {
    this.removeFileItems(file);
    for (const node of nodes) {
      this.controller.items.add(this.createTestItem(uri, node));
    }
  }

  private createTestItem(uri: vscode.Uri, node: GoTestTreeNode): vscode.TestItem {
    const item = this.controller.createTestItem(node.id, node.label, uri);
    item.range = toVsCodeRange(node.range);
    this.registeredItems.set(node.id, { item, target: node.runTarget });

    for (const child of node.children) {
      item.children.add(this.createTestItem(uri, child));
    }

    return item;
  }

  private removeFileItems(file: string): void {
    const prefix = `${encodeURIComponent('go-plus')}/${encodeURIComponent(file)}/`;
    for (const [id, registered] of [...this.registeredItems]) {
      if (!id.startsWith(prefix)) {
        continue;
      }
      registered.item.parent?.children.delete(id);
      this.controller.items.delete(id);
      this.registeredItems.delete(id);
    }
  }

  private clearAllItems(): void {
    const itemIds = [...this.controller.items].map(([id]) => id);
    for (const id of itemIds) {
      this.controller.items.delete(id);
    }
    this.registeredItems.forEach(registered => {
      registered.item.children.forEach(child => {
        registered.item.children.delete(child.id);
      });
    });
    this.registeredItems.clear();
  }

  private async runTests(request: vscode.TestRunRequest): Promise<void> {
    const run = this.controller.createTestRun(request);
    const requested = this.collectRequestedItems(request);

    for (const registered of requested) {
      run.enqueued(registered.item);
    }

    for (const registered of requested) {
      run.started(registered.item);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(registered.target.file));
      if (!workspaceFolder) {
        const message = new vscode.TestMessage('Go Plus: cannot determine workspace folder for this Go test file.');
        run.failed(registered.item, message);
        continue;
      }

      try {
        const result = await runGoTestTarget(registered.target, {
          workspaceRoot: workspaceFolder.uri.fsPath,
          output: this.output
        });
        if (result.success) {
          run.passed(registered.item);
        } else {
          run.failed(
            registered.item,
            new vscode.TestMessage(`go test failed with exit code ${result.code ?? 'unknown'}. See Go Plus output.`)
          );
        }
      } catch (error) {
        run.failed(
          registered.item,
          new vscode.TestMessage(`Go Plus: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    }

    run.end();
  }

  private collectRequestedItems(request: vscode.TestRunRequest): RegisteredTestItem[] {
    const include = request.include ?? [...this.controller.items].map(([, item]) => item);
    const excluded = new Set((request.exclude ?? []).map(item => item.id));
    const collected = new Map<string, RegisteredTestItem>();

    for (const item of include) {
      this.collectItemAndChildren(item, excluded, collected);
    }

    return [...collected.values()];
  }

  private collectItemAndChildren(
    item: vscode.TestItem,
    excluded: Set<string>,
    collected: Map<string, RegisteredTestItem>
  ): void {
    if (excluded.has(item.id)) {
      return;
    }

    const registered = this.registeredItems.get(item.id);
    if (registered) {
      collected.set(item.id, registered);
      return;
    }

    item.children.forEach(child => {
      this.collectItemAndChildren(child, excluded, collected);
    });
  }

  private outputDiagnostics(file: string, parseResult: GoTestFileParseResult): void {
    if (parseResult.diagnostics.length === 0) {
      return;
    }

    const configKey = parserConfigCacheKey(this.getConfig());
    for (const diagnostic of parseResult.diagnostics) {
      const position =
        typeof diagnostic.line === 'number'
          ? `:${diagnostic.line + 1}:${(diagnostic.character ?? 0) + 1}`
          : '';
      this.output.appendLine(`Go Plus Testing API diagnostic ${file}${position} (${configKey}): ${diagnostic.message}`);
    }
  }
}

async function openWorkspaceDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  const existing = vscode.workspace.textDocuments.find(document => document.uri.fsPath === uri.fsPath);
  return existing ?? (await vscode.workspace.openTextDocument(uri));
}

function toVsCodeRange(range: SourceRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(range.start.line, range.start.character),
    new vscode.Position(range.end.line, range.end.character)
  );
}
