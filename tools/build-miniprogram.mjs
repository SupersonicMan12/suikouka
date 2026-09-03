import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'miniprogram/lib/core.js')
mkdirSync(dirname(outfile), { recursive: true })
execFileSync(resolve(root, 'node_modules/.bin/esbuild'), [
  resolve(root, 'src/core.ts'),
  '--bundle',
  '--format=cjs',
  '--platform=neutral',
  '--target=es2018',
  '--minify',
  `--outfile=${outfile}`,
], { stdio: 'inherit' })
