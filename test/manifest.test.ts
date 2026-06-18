/**
 * 该测试保护 VSCode manifest 的骨架契约。
 * 里程碑 0 的关键交付在 `package.json` 中声明，单测直接校验这些声明，避免后续改动误删激活事件或配置项。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { commands, configurationKeys, defaultTableTestConfig } from '../src/constants';

type ExtensionManifest = {
  main: string;
  activationEvents: string[];
  contributes: {
    commands: Array<{ command: string; title: string }>;
    configuration: {
      properties: Record<string, { default: unknown }>;
    };
  };
};

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as ExtensionManifest;

describe('VSCode extension manifest', () => {
  it('points to the compiled extension entry emitted by the current TypeScript layout', () => {
    assert.equal(manifest.main, './out/src/extension.js');
  });

  it('activates for Go files, Go test workspaces, and the no-op command', () => {
    assert.deepEqual(manifest.activationEvents, [
      'onLanguage:go',
      'workspaceContains:**/*_test.go',
      'onCommand:goPlus.noop',
      'onCommand:goPlus.runTest',
      'onCommand:goPlus.refreshTestTree',
      'onCommand:goPlus.refreshCurrentFileTestTree'
    ]);
  });

  it('contributes extension commands used by startup and CodeLens execution', () => {
    assert.deepEqual(manifest.contributes.commands, [
      {
        command: commands.noop,
        title: 'Go Plus: No-op'
      },
      {
        command: commands.runTest,
        title: 'Go Plus: Run Test'
      },
      {
        command: commands.refreshTestTree,
        title: 'Go Plus: Refresh Test Tree'
      },
      {
        command: commands.refreshCurrentFileTestTree,
        title: 'Go Plus: Refresh Current File Test Tree'
      }
    ]);
  });

  it('contributes table test configuration defaults', () => {
    const properties = manifest.contributes.configuration.properties;

    assert.equal(properties[configurationKeys.enabled].default, defaultTableTestConfig.enabled);
    assert.deepEqual(properties[configurationKeys.nameFields].default, defaultTableTestConfig.nameFields);
    assert.equal(properties[configurationKeys.showFunctionRun].default, defaultTableTestConfig.showFunctionRun);
    assert.equal(properties[configurationKeys.showCaseRun].default, defaultTableTestConfig.showCaseRun);
    assert.equal(properties[configurationKeys.testingApiEnabled].default, defaultTableTestConfig.testingApiEnabled);
  });
});
