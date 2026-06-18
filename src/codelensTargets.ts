/**
 * CodeLens 目标生成的纯函数层。
 *
 * 该模块不依赖 VSCode API，方便在 Node 单元测试中验证 CodeLens provider 的核心行为：哪些入口会显示、
 * 锚定到哪个 range、命令参数是否能被 runner 使用。真正的 provider 只把这些描述转换成
 * `vscode.CodeLens` 实例。
 */

import { dirname } from 'node:path';
import type { GoTestFileParseResult, SourceRange } from './parser';
import type { GoTestRunTarget } from './runner';
import type { TableTestConfig } from './tableTestConfig';

/** 可转换为 VSCode CodeLens 的运行入口描述。 */
export type GoTestCodeLensTarget = GoTestRunCodeLensTarget | GoTestRefreshCodeLensTarget;

/** 可转换为 VSCode CodeLens 的测试运行入口描述。 */
export type GoTestRunCodeLensTarget = {
  /** CodeLens 展示标题，例如 `Run Test` 或 `Run Case`。 */
  title: 'Run Test' | 'Run Case';
  /** CodeLens 锚定范围。 */
  range: SourceRange;
  /** CodeLens 类型，provider 据此选择命令 ID。 */
  kind: 'run';
  /** 点击 CodeLens 后传给 runner 的目标参数。 */
  runTarget: GoTestRunTarget;
};

/** 可转换为 VSCode CodeLens 的当前文件测试树刷新入口描述。 */
export type GoTestRefreshCodeLensTarget = {
  /** CodeLens 展示标题。 */
  title: 'Refresh Test Tree';
  /** CodeLens 锚定范围，固定在文件顶部。 */
  range: SourceRange;
  /** CodeLens 类型，provider 据此选择刷新命令。 */
  kind: 'refreshCurrentFileTestTree';
  /** 需要刷新的 Go 测试文件路径。 */
  file: string;
};

/**
 * 根据 parser 结果和配置生成运行入口描述。
 *
 * 文件顶部始终生成当前文件测试树刷新入口；函数级入口使用函数名 range，case 级入口使用 parser
 * 已定位的 table entry range。这里集中处理配置开关，避免 VSCode provider 和后续 Testing API 原型
 * 重复实现同一套过滤规则。
 */
export function createGoTestCodeLensTargets(
  parseResult: GoTestFileParseResult,
  config: Pick<TableTestConfig, 'showFunctionRun' | 'showCaseRun'>
): GoTestCodeLensTarget[] {
  const targets: GoTestCodeLensTarget[] = [
    {
      title: 'Refresh Test Tree',
      range: topOfFileRange(),
      kind: 'refreshCurrentFileTestTree',
      file: parseResult.file
    }
  ];

  for (const testFunction of parseResult.testFunctions) {
    if (config.showFunctionRun) {
      targets.push({
        title: 'Run Test',
        range: testFunction.nameRange,
        kind: 'run',
        runTarget: {
          file: testFunction.file,
          packageDir: dirname(testFunction.file),
          testName: testFunction.name,
          subtestPath: [],
          label: testFunction.name
        }
      });
    }

    if (config.showCaseRun) {
      for (const tableCase of testFunction.tableCases) {
        targets.push({
          title: 'Run Case',
          range: tableCase.range,
          kind: 'run',
          runTarget: {
            file: tableCase.file,
            packageDir: dirname(tableCase.file),
            testName: tableCase.testName,
            subtestPath: tableCase.subtestPath,
            label: tableCase.label
          }
        });
      }
    }
  }

  return targets;
}

function topOfFileRange(): SourceRange {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 }
  };
}
