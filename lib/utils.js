// @flow

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

const handleOutputData = (proc, resolve) => {
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
};

module.exports = {
  /*prom, confirm, bail, maybeBail, gotIt,*/ handleOutputData
};
