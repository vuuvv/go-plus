/**
 * CodeLens 稳定性工具测试。
 *
 * 这些测试保护里程碑 4 新增的缓存和 debounce 行为：同一文档版本不会重复解析，文档或配置变化会
 * 失效缓存，解析失败不会留下坏缓存，高频刷新事件会被合并。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CodeLensParseCache, DebouncedCodeLensRefresh, parserConfigCacheKey } from '../src/codelensCache';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

describe('CodeLens parse cache', () => {
  it('reuses the same parse promise for an unchanged document version and parser config', async () => {
    const cache = new CodeLensParseCache<string>();
    let factoryCalls = 0;

    const first = cache.getOrCreate({ file: '/repo/a_test.go', version: 1, parserConfigKey: '["name"]' }, async () => {
      factoryCalls++;
      return 'parsed';
    });
    const second = cache.getOrCreate({ file: '/repo/a_test.go', version: 1, parserConfigKey: '["name"]' }, async () => {
      factoryCalls++;
      return 'unexpected';
    });

    assert.equal(await first, 'parsed');
    assert.equal(await second, 'parsed');
    assert.equal(factoryCalls, 1);
    assert.equal(cache.size(), 1);
  });

  it('invalidates cached parser results when document version or parser config changes', async () => {
    const cache = new CodeLensParseCache<string>();

    assert.equal(
      await cache.getOrCreate({ file: '/repo/a_test.go', version: 1, parserConfigKey: '["name"]' }, async () => 'v1'),
      'v1'
    );
    assert.equal(
      await cache.getOrCreate({ file: '/repo/a_test.go', version: 2, parserConfigKey: '["name"]' }, async () => 'v2'),
      'v2'
    );
    assert.equal(
      await cache.getOrCreate({ file: '/repo/a_test.go', version: 2, parserConfigKey: '["desc"]' }, async () => 'desc'),
      'desc'
    );

    cache.invalidateFile('/repo/a_test.go');
    assert.equal(cache.size(), 0);
  });

  it('removes rejected parse promises so a later refresh can recover', async () => {
    const cache = new CodeLensParseCache<string>();
    const key = { file: '/repo/a_test.go', version: 1, parserConfigKey: '["name"]' };

    await assert.rejects(
      cache.getOrCreate(key, async () => {
        throw new Error('parse failed');
      }),
      /parse failed/
    );
    assert.equal(cache.size(), 0);
    assert.equal(await cache.getOrCreate(key, async () => 'recovered'), 'recovered');
  });

  it('builds parser cache keys from name fields only', () => {
    assert.equal(
      parserConfigCacheKey({
        nameFields: ['name', 'desc']
      }),
      '["name","desc"]'
    );
  });
});

describe('Debounced CodeLens refresh', () => {
  it('coalesces frequent refresh requests and can flush immediately', async () => {
    let fireCount = 0;
    const refresh = new DebouncedCodeLensRefresh(20, () => {
      fireCount++;
    });

    refresh.schedule();
    refresh.schedule();
    await wait(40);
    assert.equal(fireCount, 1);

    refresh.schedule();
    refresh.flush();
    assert.equal(fireCount, 2);

    refresh.dispose();
  });
});
