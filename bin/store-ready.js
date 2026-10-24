#!/usr/bin/env node
import path from 'node:path';
import { scan, toMarkdown } from '../src/scan.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || '.');
const report = scan(root);
console.log(json ? JSON.stringify(report, null, 2) : toMarkdown(report));
process.exitCode = report.summary.fail ? 1 : 0;
