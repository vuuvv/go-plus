/**
 * runner 单元测试。
 *
 * 这些断言保护里程碑 3 最容易出错的地方：`go test -run` 的正则分段转义、包含空格或标点的 shell
 * 展示命令，以及 workspace 内 package 目录解析。真正执行 `go test` 的集成行为留给手动验证和后续
 * VSCode 集成测试。
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  buildGoTestCommand,
  buildRunPattern,
  escapeGoTestRunSegment,
  escapeRegExpLiteral,
  resolvePackageArgument,
  rewriteGoTestName,
  type GoTestRunTarget
} from '../src/runner';

describe('go test runner command construction', () => {
  it('escapes regular expression metacharacters after Go test name rewriting', () => {
    assert.equal(escapeRegExpLiteral('regex .* chars (a+b)?'), 'regex \\.\\* chars \\(a\\+b\\)\\?');
    assert.equal(rewriteGoTestName('case with spaces\tand\nlines'), 'case_with_spaces_and_lines');
    assert.equal(escapeGoTestRunSegment('path/with slash'), 'path/with_slash');
    assert.equal(
      buildRunPattern('TestNormalize', ['empty input', 'path/with slash', 'regex .* chars']),
      '^TestNormalize$/^empty_input$/^path$/^with_slash$/^regex_\\.\\*_chars$'
    );
  });

  it('builds function-level and case-level run patterns as anchored Go subtest paths', () => {
    assert.equal(buildRunPattern('TestAlpha'), '^TestAlpha$');
    assert.equal(buildRunPattern('TestAlpha', ['case one']), '^TestAlpha$/^case_one$');
  });

  it('resolves workspace package directories to go test package arguments', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');

    assert.equal(resolvePackageArgument(workspaceRoot, workspaceRoot), '.');
    assert.equal(resolvePackageArgument(join(workspaceRoot, 'internal', 'parser'), workspaceRoot), './internal/parser');
    assert.throws(() => resolvePackageArgument(join('/', 'outside', 'pkg'), workspaceRoot), /outside the workspace/);
  });

  it('quotes shell display command without changing the argv-oriented run pattern', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');
    const target: GoTestRunTarget = {
      file: join(workspaceRoot, 'pkg with space', 'normalize_test.go'),
      packageDir: join(workspaceRoot, 'pkg with space'),
      testName: 'TestNormalize',
      subtestPath: ['case with spaces', "punctuation '.*'"],
      label: 'TestNormalize/case with spaces'
    };

    assert.equal(
      buildGoTestCommand(target, workspaceRoot),
      "go test './pkg with space' -run '^TestNormalize$/^case_with_spaces$/^punctuation_'\\''\\.\\*'\\''$'"
    );
  });

  it('expands slashes inside a subtest name into Go test path segments', () => {
    const workspaceRoot = join('/', 'workspace', 'repo');
    const target: GoTestRunTarget = {
      file: join(workspaceRoot, 'pkg', 'normalize_test.go'),
      packageDir: join(workspaceRoot, 'pkg'),
      testName: 'TestNormalize',
      subtestPath: ['url path /api/v1', 'brackets [ok]'],
      label: 'TestNormalize/url path /api/v1'
    };

    assert.equal(
      buildGoTestCommand(target, workspaceRoot),
      "go test ./pkg -run '^TestNormalize$/^url_path_$/^api$/^v1$/^brackets_\\[ok\\]$'"
    );
  });
});
