import { statSync } from 'node:fs';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/**
 * Vitest shards by path hash, which put the slow files together (CI shards of 23, 25 and 63 s). This deals the
 * largest file to the lightest shard instead: size tracks run time well here and, unlike recorded durations, is the
 * same on every machine, so each shard computes the same split on its own.
 */
export class SizeSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]) {
    const { shard } = this.ctx.config;
    if (!shard) return files;
    const size = (f: TestSpecification) => statSync(f.moduleId).size;
    const shards = Array.from({ length: shard.count }, () => ({ bytes: 0, files: [] as TestSpecification[] }));
    for (const f of [...files].sort((a, b) => size(b) - size(a) || a.moduleId.localeCompare(b.moduleId))) {
      const lightest = shards.reduce((a, b) => (b.bytes < a.bytes ? b : a));
      lightest.bytes += size(f);
      lightest.files.push(f);
    }
    return shards[shard.index - 1]?.files ?? [];
  }
}
