#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('component-canvas')
  .version('0.0.0');

program.parse(process.argv);
