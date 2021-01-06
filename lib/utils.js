// @flow

// flow-next-uncovered-line
const prompts = require("prompts");
const chalk = require("chalk");

const bail = (message /*:string*/ = "Aborting") => {
  console.error(chalk.red(message));
  process.exit(1);
};

const maybeBail = async (message /*:string*/) => {
  console.error(message);
  const response = await confirm({ message: "Continue?" });
  if (!response) {
    console.error("Aborting");
    process.exit(1);
  }
};

const gotIt = async (message /*:string*/) => {
  console.log(message);
  // flow-next-uncovered-line
  await prompts({ type: "text", name: "ignored", message: "Got it!" });
};

function prom /*:: <T>*/(
  fn /*:
  ((err: ?Error, value: T) => void) => void
  */
) /*:Promise<T>*/ {
  return new Promise((res, rej) =>
    fn((err, value) => (err ? rej(err) : res(value)))
  );
}

const confirm = async (
  { message, pre } /*: {message: string, pre?: string}*/
) => {
  if (pre) {
    console.error(pre);
  }
  /* flow-uncovered-block */
  const response /*:{continue: boolean}*/ = await prompts({
    type: "confirm",
    name: "continue",
    message
  });
  /* end flow-uncovered-block */
  return response.continue;
};

module.exports = { prom, confirm, bail, maybeBail, gotIt };
