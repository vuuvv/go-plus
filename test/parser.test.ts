/**
 * parser 里程碑测试。
 *
 * 这些测试直接驱动 Go helper parser，保护第一阶段退出标准：识别 `_test.go` 中的测试函数、
 * 返回 VSCode 兼容源码 range，并在语法未完成时给出可恢复诊断而不是让调用方崩溃。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GoHelperParser, isGoTestFile } from '../src/parser';
import type { GoTestFileParseResult, GoTestFunctionMetadata, TableTestCaseMetadata } from '../src/parser';

const fixtureRoot = join(process.cwd(), 'test', 'fixtures', 'parser');
const parser = new GoHelperParser({ timeoutMs: 15_000 });

function readFixture(name: string): { file: string; source: string } {
  const file = join(fixtureRoot, name);
  return {
    file,
    source: readFileSync(file, 'utf8')
  };
}

function findTestFunction(result: GoTestFileParseResult, name: string): GoTestFunctionMetadata {
  const testFunction = result.testFunctions.find(candidate => candidate.name === name);
  assert.ok(testFunction, `Expected to find ${name}`);
  return testFunction;
}

function findCase(testFunction: GoTestFunctionMetadata, subtestName: string): TableTestCaseMetadata {
  const tableCase = testFunction.tableCases.find(candidate => candidate.subtestName === subtestName);
  assert.ok(tableCase, `Expected to find ${testFunction.name}/${subtestName}`);
  return tableCase;
}

function lineOf(source: string, text: string): number {
  const offset = source.indexOf(text);
  assert.notEqual(offset, -1, `Expected fixture to contain ${text}`);
  return source.slice(0, offset).split('\n').length - 1;
}

describe('Go helper parser', () => {
  it('detects Go test files by suffix', () => {
    assert.equal(isGoTestFile('/workspace/foo_test.go'), true);
    assert.equal(isGoTestFile('/workspace/foo.go'), false);
  });

  it('extracts test functions with source ranges from a valid _test.go file', async () => {
    const fixture = readFixture('basic_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.file, fixture.file);
    assert.equal(result.packageName, 'parserfixture');
    assert.deepEqual(
      result.testFunctions.map(testFunction => testFunction.name),
      ['TestAlpha', 'TestSecond']
    );
    assert.deepEqual(result.diagnostics, []);

    const [first] = result.testFunctions;
    assert.equal(first?.range.start.line, 5);
    assert.equal(first?.range.start.character, 0);
    assert.deepEqual(first?.nameRange.start, { line: 5, character: 5 });
    assert.deepEqual(first?.nameRange.end, { line: 5, character: 14 });
    assert.deepEqual(first?.tableCases, []);
  });

  it('skips files that are not named _test.go before invoking Go parsing work', async () => {
    const fixture = readFixture('plain.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.file, fixture.file);
    assert.equal(result.packageName, '');
    assert.deepEqual(result.testFunctions, []);
    assert.deepEqual(result.diagnostics, []);
  });

  it('returns diagnostics for incomplete syntax while preserving complete test functions', async () => {
    const fixture = readFixture('incomplete_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.equal(result.packageName, 'parserfixture');
    assert.equal(result.testFunctions[0]?.name, 'TestCompleteBeforeError');
    assert.ok(result.diagnostics.length > 0);
    assert.equal(result.diagnostics[0]?.severity, 'error');
  });

  it('maps keyed table entries to t.Run selector names with exact source ranges', async () => {
    const fixture = readFixture('table_cases_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);
    const testFunction = findTestFunction(result, 'TestKeyedNameTable');

    assert.deepEqual(
      testFunction.tableCases.map(tableCase => tableCase.label),
      [
        'TestKeyedNameTable/empty input',
        'TestKeyedNameTable/regex .* chars',
        'TestKeyedNameTable/url path /api/v1 [ok]'
      ]
    );

    const emptyCase = findCase(testFunction, 'empty input');
    assert.equal(emptyCase.file, fixture.file);
    assert.equal(emptyCase.testName, 'TestKeyedNameTable');
    assert.deepEqual(emptyCase.subtestPath, ['empty input']);
    assert.equal(emptyCase.confidence, 'exact');
    assert.equal(emptyCase.range.start.line, lineOf(fixture.source, '{name: "empty input"'));
  });

  it('recognizes configured default name fields beyond name', async () => {
    const fixture = readFixture('table_cases_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.deepEqual(
      findTestFunction(result, 'TestDescFieldTable').tableCases.map(tableCase => tableCase.subtestName),
      ['zero']
    );
    assert.deepEqual(
      findTestFunction(result, 'TestInlineTable').tableCases.map(tableCase => tableCase.subtestName),
      ['inline case']
    );
  });

  it('uses struct field order for positional table entries when the name field is static', async () => {
    const fixture = readFixture('table_cases_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);
    const positionalCase = findCase(findTestFunction(result, 'TestPositionalTable'), 'first positional');

    assert.equal(positionalCase.range.start.line, lineOf(fixture.source, '{"first positional"'));
    assert.equal(positionalCase.confidence, 'exact');
  });

  it('uses string map keys as case names when t.Run receives the range key', async () => {
    const fixture = readFixture('table_cases_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);
    const mapCase = findCase(findTestFunction(result, 'TestMapTable'), 'map key case');

    assert.equal(mapCase.label, 'TestMapTable/map key case');
    assert.equal(mapCase.range.start.line, lineOf(fixture.source, '"map key case"'));
  });

  it('skips dynamic t.Run names instead of emitting unsupported runnable cases', async () => {
    const fixture = readFixture('table_cases_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.deepEqual(findTestFunction(result, 'TestDynamicNamesAreSkipped').tableCases, []);
  });

  it('skips unsupported table patterns that would require data-flow or runtime evaluation', async () => {
    const fixture = readFixture('unsupported_patterns_test.go');
    const result = await parser.parseTestFile(fixture.file, fixture.source);

    assert.deepEqual(
      result.testFunctions.map(testFunction => [testFunction.name, testFunction.tableCases.length]),
      [
        ['TestHelperReturnedTableIsSkipped', 0],
        ['TestVariableBackedEntryNameIsSkipped', 0],
        ['TestAliasedRunNameIsSkipped', 0],
        ['TestFormattedMapKeyIsSkipped', 0]
      ]
    );
  });
});
