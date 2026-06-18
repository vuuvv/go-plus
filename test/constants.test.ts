/**
 * 里程碑 0 的基础测试聚焦在稳定契约：命令 ID、output channel 和默认配置。
 * 这些值会被 `package.json`、后续 CodeLens provider 和 runner 共同依赖，先用轻量测试保护漂移风险。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commands, configurationKeys, defaultTableTestConfig, outputChannelName } from '../src/constants';

describe('extension skeleton constants', () => {
  it('uses the contributed no-op command id', () => {
    assert.equal(commands.noop, 'goPlus.noop');
    assert.equal(commands.runTest, 'goPlus.runTest');
    assert.equal(commands.refreshTestTree, 'goPlus.refreshTestTree');
    assert.equal(commands.refreshCurrentFileTestTree, 'goPlus.refreshCurrentFileTestTree');
  });

  it('uses a stable output channel name', () => {
    assert.equal(outputChannelName, 'Go Plus');
  });

  it('keeps table test defaults aligned with milestone 0 requirements', () => {
    assert.deepEqual(defaultTableTestConfig, {
      enabled: true,
      nameFields: ['name', 'desc', 'caseName', 'title'],
      showFunctionRun: true,
      showCaseRun: true,
      testingApiEnabled: false
    });
  });

  it('defines configuration keys under the goPlus.tableTests namespace', () => {
    assert.deepEqual(Object.values(configurationKeys), [
      'goPlus.tableTests.enabled',
      'goPlus.tableTests.nameFields',
      'goPlus.tableTests.showFunctionRun',
      'goPlus.tableTests.showCaseRun',
      'goPlus.tableTests.testingApi.enabled'
    ]);
  });
});
