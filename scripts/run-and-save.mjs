// Runs a command, streams its output to the console AND saves it verbatim to a file,
// with a header that records exactly what was run, when, and on which commit.
// The exit code of the command is preserved, so a red run stays red in CI and in the file.
//
// usage: node scripts/run-and-save.mjs <output-file> -- <command> [args...]
import { execSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import os from 'node:os';

const sep = process.argv.indexOf('--');
const outFile = process.argv[2];
if (!outFile || sep === -1 || sep === process.argv.length - 1) {
  console.error('usage: node scripts/run-and-save.mjs <output-file> -- <command> [args...]');
  process.exit(2);
}
const [cmd, ...args] = process.argv.slice(sep + 1);

function git(command) {
  try {
    return execSync(`git ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'n/a';
  }
}
const commit = git('rev-parse --short HEAD');
// results/ is excluded: this script writes there itself, so it says nothing about the code under test.
const dirty = git("status --porcelain -- . ':(exclude)results'") ? ' (working tree has uncommitted changes)' : '';

const header = [
  `# command:  ${[cmd, ...args].join(' ')}`,
  `# date:     ${new Date().toISOString()}`,
  `# commit:   ${commit}${dirty}`,
  `# node:     ${process.version}`,
  `# platform: ${os.platform()} ${os.arch()} · ${os.cpus()[0]?.model ?? 'unknown cpu'} · TZ=${process.env.TZ ?? '(unset)'}`,
  '',
].join('\n');

const chunks = [header];
const child = spawn(cmd, args, {
  // Colour env vars are left to the caller (see package.json): Vitest needs NO_COLOR, while
  // Playwright sets FORCE_COLOR for its own children and Node warns if both are present.
  stdio: ['inherit', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => {
  process.stdout.write(d);
  chunks.push(d.toString());
});
child.stderr.on('data', (d) => {
  process.stderr.write(d);
  chunks.push(d.toString());
});
child.on('close', (code) => {
  chunks.push(`\n# exit code: ${code}\n`);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, chunks.join(''));
  console.log(`\nsaved output to ${outFile} (exit code ${code})`);
  process.exit(code ?? 1);
});
