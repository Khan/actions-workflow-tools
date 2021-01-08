// @flow
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");
const downloadGitRepo = require("download-git-repo");
const { spawn } = require("child_process");
const { handleOutputData } = require("../lib/utils");

/*::
type ActionYaml = {
    runs: {
        main: string,
        using: string
    }
}
*/

const ensureUses = async (name, target) => {
  if (!fs.existsSync(target)) {
    console.log(`Fetching ${name}`);
    await new Promise((res, rej) =>
      downloadGitRepo(name, target, err => (err ? rej(err) : res()))
    );
    console.log(`Fetched`);
  }
  const actionsPath = path.join(target, "action.yml");
  if (!fs.existsSync(actionsPath)) {
    throw new Error(`No action.yml found in ${name} (downloaded to ${target})`);
  }
  const mixed = yaml.safeLoad(fs.readFileSync(actionsPath, "utf8"));
  // flow-next-uncovered-line
  const res /*:ActionYaml*/ = /*::(*/ mixed /*:any)*/;
  return res;
};

const runUses = async (
  workspace /*:string*/,
  cacheDirectory /*:string*/,
  name /*:string*/,
  args /*:?{[key: string]: string}*/
) => {
  const sanitized = name.replace(/[^a-zA-Z_-]/g, "-");
  const target = path.join(
    cacheDirectory,
    `node_modules/.actions-cache/${sanitized}`
  );
  const config = await ensureUses(name, target);
  const main = path.join(target, config.runs.main);
  if (!config.runs.using.match(/^node/)) {
    throw new Error("Can only run node actions");
  }
  /* flow-uncovered-block */
  const env /*:{[key: string]: string}*/ = {
    ...process.env,
    FORCE_COLOR: 1
  };
  /* end flow-uncovered-block */
  if (args) {
    for (let key in args) {
      env[`INPUT_${key.toUpperCase()}`] = args[key];
    }
  }

  return handleOutputData("node", [main], {
    shell: false,
    cwd: workspace,
    env
  });
};

module.exports = { runUses };
