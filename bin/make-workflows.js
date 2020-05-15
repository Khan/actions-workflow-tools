#!/usr/bin/env node
// @flow

// $FlowFixMe: shhhhh
require('@babel/register'); // flow-uncovered-line

const fs = require('fs');
const path = require('path');
const { processFile } = require('../lib/workflow-preprocessor');

const outDir = '.github/workflows';
const inDir = '.github/workflow-templates';

fs.readdirSync(inDir)
    .filter((name) => name.endsWith('.yml') && !name.startsWith('_'))
    .forEach((fname) => {
        console.log(fname);
        processFile(path.resolve(inDir, fname), path.join(outDir, fname));
    });
