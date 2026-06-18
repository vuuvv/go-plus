/**
 * `go test -run` 命令构造和执行模块。
 *
 * runner 只依赖标准 Go 工具链：输入是 parser/CodeLens 产出的测试目标，输出是可复现的
 * `go test <package> -run <pattern>` 调用。命令构造保持纯函数，便于用单元测试覆盖正则转义、
 * package 路径和 shell 展示文本；真正执行时使用 `spawn`，避免阻塞 VSCode Extension Host。
 */

import { spawn } from 'node:child_process';
import { dirname, isAbsolute, relative, sep } from 'node:path';

/** runner 输出目标的最小接口，VSCode OutputChannel 和测试替身都能满足。 */
export type RunnerOutput = {
  /** 追加一行用户可读文本。 */
  appendLine(message: string): void;
  /** 追加原始输出，保留 `go test` 自己的换行和格式。 */
  append(message: string): void;
};

/** CodeLens 命令传给 runner 的可运行测试目标。 */
export type GoTestRunTarget = {
  /** 测试文件绝对路径，用于在缺少 packageDir 时兜底解析目录。 */
  file: string;
  /** Go package 所在目录，通常是测试文件父目录。 */
  packageDir?: string;
  /** 顶层测试函数名，例如 `TestNormalize`。 */
  testName: string;
  /** subtest 路径；函数级运行入口传空数组。 */
  subtestPath: string[];
  /** UI 展示标签，写入 output channel 便于用户确认触发目标。 */
  label: string;
};

/** 执行 `go test` 时需要的环境参数。 */
export type GoTestRunnerOptions = {
  /** VSCode workspace root，作为命令 cwd 和 package 相对路径基准。 */
  workspaceRoot: string;
  /** Go 命令路径，默认使用 PATH 中的 `go`。 */
  goCommand?: string;
  /** 输出接收方，通常是扩展共享的 output channel。 */
  output: RunnerOutput;
};

/** `go test` 子进程完成后的结果。 */
export type GoTestRunResult = {
  /** 子进程退出码；被信号终止或启动失败时可能为空。 */
  code: number | null;
  /** `go test` 进程是否按零退出码成功完成。 */
  success: boolean;
};

/** 正则元字符转义，保证用户源码里的 case 名称按字面量匹配。 */
export function escapeRegExpLiteral(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * 转义单个 Go `-run` 路径段。
 *
 * `t.Run` 注册 subtest 时，Go testing 会先把 subtest 名称改写为“可打印且无空白”的匹配名：
 * 空格、换行、tab 等空白字符都会变成 `_`。runner 保留 UI label 的源码原名，但构造 `-run` 时必须
 * 使用这个匹配名，否则带空格的 case 会显示正确却无法被 Go 选中。
 */
export function escapeGoTestRunSegment(value: string): string {
  return escapeRegExpLiteral(rewriteGoTestName(value));
}

/** 按 Go testing 的 subtest name rewrite 规则处理空白字符。 */
export function rewriteGoTestName(value: string): string {
  return Array.from(value)
    .map(character => (isGoTestingSpace(character.codePointAt(0) ?? 0) ? '_' : character))
    .join('');
}

/**
 * 构造 Go subtest 选择路径。
 *
 * Go 的 `-run` 会按 `/` 分段匹配顶层测试和 subtest；每段分别加 `^...$`，可以避免
 * `TestFooBar` 或相似 case 名称被误匹配。Go testing 同样会把 subtest 名称中的 `/` 当成层级切分，
 * 所以源码里的一个 case 名称如果包含 `/api/v1`，这里也要展开成多个 pattern 段才能命中。
 */
export function buildRunPattern(testName: string, subtestPath: readonly string[] = []): string {
  return [testName, ...subtestPath]
    .flatMap(segment => rewriteGoTestName(segment).split('/'))
    .map(segment => `^${escapeRegExpLiteral(segment)}$`)
    .join('/');
}

/**
 * 将 package 目录解析为 `go test` 可接受的 package 参数。
 *
 * 当前产品要求以 workspace root 作为 cwd，因此 workspace 内目录转为 `./relative/package`；
 * workspace 根目录本身使用 `.`。如果文件不在 workspace 下，抛出错误并由命令入口提示用户，
 * 避免在错误 cwd 下运行到无关 package。
 */
export function resolvePackageArgument(packageDir: string, workspaceRoot: string): string {
  const relativeDir = relative(workspaceRoot, packageDir);
  if (relativeDir === '') {
    return '.';
  }
  if (relativeDir.startsWith('..') || isAbsolute(relativeDir)) {
    throw new Error(`Package directory is outside the workspace: ${packageDir}`);
  }
  return `./${relativeDir.split(sep).join('/')}`;
}

/** 构造可展示或可粘贴到 shell 的 `go test` 命令文本。 */
export function buildGoTestCommand(target: GoTestRunTarget, workspaceRoot: string, goCommand = 'go'): string {
  const packageDir = target.packageDir ?? dirname(target.file);
  const packageArg = resolvePackageArgument(packageDir, workspaceRoot);
  const runPattern = buildRunPattern(target.testName, target.subtestPath);
  return [goCommand, 'test', packageArg, '-run', runPattern].map(shellQuote).join(' ');
}

/**
 * 异步执行目标测试。
 *
 * stdout/stderr 按原样写入 output channel，失败时不吞掉 Go 原始输出；调用方只需要根据返回码决定
 * 是否弹出错误提示。使用 argv 数组启动进程，避免 shell 对正则里的 `$`、空格和标点再次解释。
 */
export async function runGoTestTarget(
  target: GoTestRunTarget,
  options: GoTestRunnerOptions
): Promise<GoTestRunResult> {
  const goCommand = options.goCommand ?? 'go';
  const packageDir = target.packageDir ?? dirname(target.file);
  const packageArg = resolvePackageArgument(packageDir, options.workspaceRoot);
  const runPattern = buildRunPattern(target.testName, target.subtestPath);

  options.output.appendLine('');
  options.output.appendLine(`Running ${target.label}`);
  options.output.appendLine(`$ ${buildGoTestCommand(target, options.workspaceRoot, goCommand)}`);

  return await new Promise((resolve, reject) => {
    const child = spawn(goCommand, ['test', packageArg, '-run', runPattern], {
      cwd: options.workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      options.output.append(chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      options.output.append(chunk);
    });

    child.on('error', error => {
      reject(error);
    });

    child.on('close', code => {
      resolve({ code, success: code === 0 });
    });
  });
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isGoTestingSpace(codePoint: number): boolean {
  if (codePoint < 0x2000) {
    return (
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      codePoint === 0x0d ||
      codePoint === 0x20 ||
      codePoint === 0x85 ||
      codePoint === 0xa0 ||
      codePoint === 0x1680
    );
  }

  if (codePoint <= 0x200a) {
    return true;
  }

  return codePoint === 0x2028 || codePoint === 0x2029 || codePoint === 0x202f || codePoint === 0x205f || codePoint === 0x3000;
}
