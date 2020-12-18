#!/usr/bin/env node
// @flow

// $FlowFixMe: shhhhh
require("@babel/register"); // flow-uncovered-line

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { processFile } = require("../lib/workflow-preprocessor");

const topLevel = execSync("git rev-parse --show-toplevel")
  .toString("utf8")
  .trim();
const outDir = path.join(topLevel, ".github/workflows");
const inDir = path.join(topLevel, ".github/workflow-templates");

fs.readdirSync(inDir)
  .filter(name => name.endsWith(".yml") && !name.startsWith("_"))
  .forEach(fname => {
    console.log(fname);
    processFile(path.resolve(inDir, fname), path.join(outDir, fname));
  });
