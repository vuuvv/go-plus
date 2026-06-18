/**
 * Go Plus VSCode 扩展入口。
 *
 * 入口负责把可独立测试的模块接入 VSCode 生命周期：注册命令、创建 output channel、挂载 Go 测试
 * 文件 CodeLens provider，并把用户点击的运行目标交给 runner。具体识别和命令构造留在独立模块，
 * 让 Extension Host 入口保持薄而稳定。
 */

import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { commands, configurationKeys, outputChannelName } from './constants';
import { GoTestCodeLensProvider } from './codelens';
import { isGoTestFile } from './parser';
import { runGoTestTarget, type GoTestRunTarget } from './runner';
import { GoPlusTestingApiPrototypeManager } from './testing';
import { normalizeTableTestConfig } from './tableTestConfig';

/**
 * 激活扩展并注册当前阶段的基础能力。
 *
 * VSCode 会在 `package.json` 中声明的 Go 语言、Go 测试文件或 no-op 命令触发时调用该函数。
 * output channel 放入 `context.subscriptions`，确保 Extension Host 关闭或重载时能释放资源。
 */
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(outputChannelName);
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine('Go Plus activated.');

  const noopCommand = vscode.commands.registerCommand(commands.noop, () => {
    outputChannel.appendLine('Go Plus no-op command executed.');
    void vscode.window.showInformationMessage('Go Plus is active.');
  });

  const runTestCommand = vscode.commands.registerCommand(commands.runTest, async (target: unknown) => {
    outputChannel.show(true);

    try {
      const normalizedTarget = normalizeRunTarget(target);
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalizedTarget.file));
      if (!workspaceFolder) {
        void vscode.window.showErrorMessage('Go Plus: cannot determine workspace folder for this Go test file.');
        return;
      }

      const result = await runGoTestTarget(normalizedTarget, {
        workspaceRoot: workspaceFolder.uri.fsPath,
        output: outputChannel
      });

      if (!result.success) {
        void vscode.window.showErrorMessage(`Go Plus: go test failed with exit code ${result.code ?? 'unknown'}.`);
      }
    } catch (error) {
      outputChannel.appendLine(`Go Plus run failed: ${String(error)}`);
      void vscode.window.showErrorMessage(`Go Plus: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const goTestCodeLensProvider = new GoTestCodeLensProvider({ output: outputChannel });
  const testingApiPrototype = new GoPlusTestingApiPrototypeManager({ output: outputChannel });
  testingApiPrototype.setEnabled(readTestingApiEnabledFromWorkspace());

  const refreshTestTreeCommand = vscode.commands.registerCommand(commands.refreshTestTree, async () => {
    outputChannel.show(true);
    if (!readTestingApiEnabledFromWorkspace()) {
      void vscode.window.showInformationMessage(
        'Go Plus: enable goPlus.tableTests.testingApi.enabled before refreshing the Test Explorer tree.'
      );
      return;
    }

    testingApiPrototype.setEnabled(true);
    const refreshed = await testingApiPrototype.refreshWorkspace();
    void vscode.window.showInformationMessage(`Go Plus: refreshed Test Explorer tree from ${refreshed} Go test file(s).`);
  });

  const refreshCurrentFileTestTreeCommand = vscode.commands.registerCommand(
    commands.refreshCurrentFileTestTree,
    async (fileArg: unknown) => {
      outputChannel.show(true);
      if (!readTestingApiEnabledFromWorkspace()) {
        void vscode.window.showInformationMessage(
          'Go Plus: enable goPlus.tableTests.testingApi.enabled before refreshing the current file in Test Explorer.'
        );
        return;
      }

      const file = normalizeRefreshFileArgument(fileArg);
      if (!file || !isGoTestFile(file)) {
        void vscode.window.showErrorMessage('Go Plus: open a Go _test.go file before refreshing the current test tree.');
        return;
      }

      testingApiPrototype.setEnabled(true);
      const refreshed = await testingApiPrototype.refreshFile(file);
      if (!refreshed) {
        void vscode.window.showErrorMessage('Go Plus: current file is not a Go test file.');
        return;
      }
      void vscode.window.showInformationMessage('Go Plus: refreshed current file in Test Explorer.');
    }
  );

  const codeLensRegistration = vscode.languages.registerCodeLensProvider(
    { language: 'go', scheme: 'file', pattern: '**/*_test.go' },
    goTestCodeLensProvider
  );

  const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    goTestCodeLensProvider.refreshDocument(event.document.uri.fsPath);
    testingApiPrototype.refreshDocument(event.document);
  });
  const documentSaveSubscription = vscode.workspace.onDidSaveTextDocument(document => {
    goTestCodeLensProvider.refreshDocument(document.uri.fsPath);
    testingApiPrototype.refreshDocument(document);
  });
  const configurationSubscription = vscode.workspace.onDidChangeConfiguration(event => {
    if (Object.values(configurationKeys).some(key => event.affectsConfiguration(key))) {
      goTestCodeLensProvider.refreshAll();
      testingApiPrototype.setEnabled(readTestingApiEnabledFromWorkspace());
      for (const document of vscode.workspace.textDocuments) {
        testingApiPrototype.refreshDocument(document);
      }
    }
  });

  context.subscriptions.push(
    noopCommand,
    runTestCommand,
    refreshTestTreeCommand,
    refreshCurrentFileTestTreeCommand,
    goTestCodeLensProvider,
    testingApiPrototype,
    codeLensRegistration,
    documentChangeSubscription,
    documentSaveSubscription,
    configurationSubscription
  );
}

function normalizeRefreshFileArgument(fileArg: unknown): string | undefined {
  if (typeof fileArg === 'string' && fileArg !== '') {
    return fileArg;
  }
  return vscode.window.activeTextEditor?.document.uri.fsPath;
}

/** 从 VSCode 配置读取实验 Testing API 开关。 */
function readTestingApiEnabledFromWorkspace(): boolean {
  const configuration = vscode.workspace.getConfiguration();
  return normalizeTableTestConfig({
    testingApiEnabled: configuration.get(configurationKeys.testingApiEnabled)
  }).testingApiEnabled;
}

/**
 * 当前阶段无需显式清理状态。
 *
 * output channel 和命令注册都由 `context.subscriptions` 托管；保留该函数是为了让后续异步 watcher、
 * debounce timer 或 child process 管理有一个明确的关闭扩展点。
 */
export function deactivate(): void {
  // 由 VSCode 订阅生命周期统一释放资源。
}

function normalizeRunTarget(target: unknown): GoTestRunTarget {
  if (!target || typeof target !== 'object') {
    throw new Error('Run target is missing. Trigger this command from a Go Plus CodeLens entry.');
  }

  const candidate = target as Partial<GoTestRunTarget>;
  if (typeof candidate.file !== 'string' || candidate.file === '') {
    throw new Error('Run target does not include a Go test file path.');
  }
  if (typeof candidate.testName !== 'string' || candidate.testName === '') {
    throw new Error('Run target does not include a Go test function name.');
  }
  if (typeof candidate.label !== 'string' || candidate.label === '') {
    throw new Error('Run target does not include a display label.');
  }

  return {
    file: candidate.file,
    packageDir: typeof candidate.packageDir === 'string' ? candidate.packageDir : dirname(candidate.file),
    testName: candidate.testName,
    subtestPath: Array.isArray(candidate.subtestPath)
      ? candidate.subtestPath.filter((segment): segment is string => typeof segment === 'string')
      : [],
    label: candidate.label
  };
}
