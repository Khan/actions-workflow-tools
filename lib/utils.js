// @flow
const {spawn} = require('child_process');

const countInstances = (rx, text /*:string*/) => {
    let num = 0;
    text.replace(rx, () => {
        num += 1;
        return '';
    });
    return num;
};

const indent = (text /*: string*/) => {
    return '|  ' + text.replace(/\n(?!$)/g, '\n|  ');
};

const runProcess = (
    cmd /*: string*/,
    args /*: Array<string>*/,
    options /*: { shell?: boolean, cwd?: string, env?: { [key: string]: string } }*/,
) /*: Promise<{ errors: number, failed: boolean}>*/ => {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {...options});

        let errors = 0;
        const errorRx = /^:error:/gm;

        proc.stdout.on('data', (data /*:Buffer*/) => {
            const text = data.toString('utf8');
            errors += countInstances(errorRx, text);
            process.stdout.write(indent(text));
        });

        proc.stderr.on('data', (data /*:Buffer*/) => {
            const text = data.toString('utf8');
            errors += countInstances(errorRx, text);
            // We use stdout for the stderr as well to avoid interleaving
            // issues.
            process.stdout.write(indent(text));
        });

        proc.on('close', (code /*:number*/) => {
            if (code === 0) {
                resolve({errors, failed: false});
            } else {
                console.log(`child process exited with code ${code}`);
                resolve({errors, failed: true});
            }
        });
    });
};

module.exports = {
    runProcess,
};
