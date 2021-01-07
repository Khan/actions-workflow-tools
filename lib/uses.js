// @flow
const fs = require("fs");
const yaml = require("js-yaml");
const path = require("path");
const downloadGitRepo = require("download-git-repo");
const { spawn } = require("child_process");

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

const countInstances = (rx, text /*:string*/) => {
  let num = 0;
  text.replace(rx, () => {
    num += 1;
    return "";
  });
  return num;
};

const indent = (text /*: string*/) => {
  return "|  " + text.replace(/\n(?!$)/g, "\n|  ");
};

const runUses = async (
  workspace /*:string*/,
  name /*:string*/,
  args /*:?{[key: string]: string}*/
) => {
  const sanitized = name.replace(/[^a-zA-Z_-]/g, "-");
  const target = path.join(
    workspace,
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

  return await new Promise((resolve, reject) => {
    const proc = spawn("node", [main], {
      shell: false,
      cwd: workspace,
      env
    });

    let errors = 0;
    const errorRx = /^:error:/gm;

    proc.stdout.on("data", (data /*:Buffer*/) => {
      const text = data.toString("utf8");
      errors += countInstances(errorRx, text);
      process.stdout.write(indent(text));
    });

    proc.stderr.on("data", (data /*:Buffer*/) => {
      const text = data.toString("utf8");
      errors += countInstances(errorRx, text);
      // We use stdout for the stderr as well to avoid interleaving
      // issues.
      process.stdout.write(indent(text));
    });

    proc.on("close", (code /*:number*/) => {
      if (code === 0) {
        resolve({ errors, failed: false });
      } else {
        console.log(`child process exited with code ${code}`);
        resolve({ errors, failed: true });
      }
    });
  });
};

module.exports = { runUses };
