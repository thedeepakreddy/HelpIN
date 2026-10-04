// kysely-codegen imports `postgres-interval` for interval columns (only used by metrics views);
// pnpm doesn't expose that transitive package, so type intervals as strings instead.
import { readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
const file = new URL('../src/schema.ts', import.meta.url);
const src = readFileSync(file, 'utf8')
  .replace(/import type \{ IPostgresInterval \} from "postgres-interval";\n/, '')
  .replace(/export type Interval = ColumnType<IPostgresInterval,[^;]+;/, 'export type Interval = string;');
writeFileSync(file, src);
// bigint columns are parsed to numbers (see src/index.ts).
writeFileSync(file, readFileSync(file, 'utf8').replace(
  'export type Int8 = ColumnType<string, bigint | number | string, bigint | number | string>;',
  'export type Int8 = ColumnType<number, bigint | number | string, bigint | number | string>;',
));
