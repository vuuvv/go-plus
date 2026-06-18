/**
 * CodeLens 解析缓存与刷新调度工具。
 *
 * VSCode 在编辑、滚动、切换标签页时可能频繁请求 CodeLens。该模块不依赖 VSCode API，
 * 只负责两件事：按文档版本缓存 parser 结果，以及把高频刷新请求 debounce 成一次事件。
 * 这样 provider 可以复用未变化 buffer 的解析结果，同时仍能在文档或配置变化后主动失效。
 */

import type { TableTestConfig } from './tableTestConfig';

/** 描述一次可缓存解析的文档状态。 */
export type CodeLensCacheKey = {
  /** 文档绝对路径。 */
  file: string;
  /** VSCode 文档版本；文本变化时会递增。 */
  version: number;
  /** 影响 parser 输出的配置签名。 */
  parserConfigKey: string;
};

type CacheEntry<TResult> = {
  version: number;
  parserConfigKey: string;
  promise: Promise<TResult>;
};

/**
 * 按文件维护 parser 结果缓存。
 *
 * 缓存值保存 Promise 而不是最终结果，能合并同一文档版本上的并发 CodeLens 请求；如果解析失败，
 * 对应条目会自动移除，避免一次临时错误长期污染后续刷新。
 */
export class CodeLensParseCache<TResult> {
  private readonly entries = new Map<string, CacheEntry<TResult>>();

  /** 返回缓存结果，或调用 factory 创建并记录新的解析 Promise。 */
  public getOrCreate(key: CodeLensCacheKey, factory: () => Promise<TResult>): Promise<TResult> {
    const existing = this.entries.get(key.file);
    if (
      existing &&
      existing.version === key.version &&
      existing.parserConfigKey === key.parserConfigKey
    ) {
      return existing.promise;
    }

    const entry: CacheEntry<TResult> = {
      version: key.version,
      parserConfigKey: key.parserConfigKey,
      promise: factory()
    };
    this.entries.set(key.file, entry);

    entry.promise.catch(() => {
      if (this.entries.get(key.file) === entry) {
        this.entries.delete(key.file);
      }
    });

    return entry.promise;
  }

  /** 文档内容变化或保存时清理单个文件缓存。 */
  public invalidateFile(file: string): void {
    this.entries.delete(file);
  }

  /** 配置变化或扩展停用时清理所有缓存。 */
  public clear(): void {
    this.entries.clear();
  }

  /** 测试辅助：当前缓存文件数。 */
  public size(): number {
    return this.entries.size;
  }
}

/** 生成只覆盖 parser 相关配置的缓存签名。 */
export function parserConfigCacheKey(config: Pick<TableTestConfig, 'nameFields'>): string {
  return JSON.stringify(config.nameFields);
}

/**
 * 简单 debounce 调度器。
 *
 * provider 在文档编辑事件中调用 `schedule`，最后只触发一次 `fire`。这避免用户连续输入时反复
 * 让 VSCode 重新请求 CodeLens，也为后续替换成更复杂的 watcher 留出集中入口。
 */
export class DebouncedCodeLensRefresh {
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(
    private readonly delayMs: number,
    private readonly fire: () => void
  ) {}

  /** 安排一次延迟刷新；重复调用会把刷新推迟到最后一次调用之后。 */
  public schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.fire();
    }, this.delayMs);
  }

  /** 立即触发刷新，并取消任何已排队的延迟刷新。 */
  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.fire();
  }

  /** 扩展停用时取消未触发的 timer，避免 Extension Host 悬挂异步回调。 */
  public dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
