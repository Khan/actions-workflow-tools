#!/usr/bin/env node
// @flow
/**
 * This file can be used to run github action workflows locally!
 *
 * There are a couple of caveats, in that this only supports as much of the
 * workflow syntax as we happen to need.
 * For example, `env` variables are not currently set, and scripts actually
 * use this to determine whether they're being run by github actions or
 * locally with this script.
 * Also, steps that use external actions (like checkout) are just skipped.
 * This is fine for us, as all of the external actions that we're using
 * are for setup-y things.
 *
 * This file also understands our "extended" workflow format, which is
 * described by `action-preprocessor.js` in more detail. And all `setup`
 * steps are ignored, instead assuming that your machine is already set up
 * for development.
 *
 * It is expected to be used like this:
 * ```sh
 * $ run.js autofix
 * $ run.js lint
 * $ run.js unit
 * $ run.js unit_long
 * $ run.js prepare (or pr)
 * ```
 */

const chalk = require('chalk');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const workspace = process.cwd();
const { runUses } = require('../lib/uses');

const gitChangedFiles = require('actions-utils/git-changed-files');
const getBaseRef = require('actions-utils/get-base-ref');

let _verbose = false;

const debug = (...args) => {
    if (_verbose) {
        console.log(...args);
    }
};

const plural = (num, single, plural) => (num === 1 ? single : plural);

const matches = (jobId /* :string*/, type) => {
    return (
        jobId === type ||
        jobId.endsWith('-' + type) ||
        jobId.endsWith('_' + type)
    );
};

function escapeRegExp(string /*: string*/) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

const matchPath = (path /*: string*/, file) => {
    const rxString =
        '^' +
        escapeRegExp(path).replace(/(\\\*\\\*\/\\\*|(:?\\\*)+)/g, (matched) => {
            if (matched === '\\*\\*/\\*' || matched === '\\*\\*') {
                return '.*';
            } else {
                return '[^\\/]*';
            }
        }) +
        '$';
    if (file.match(new RegExp(rxString))) {
        return true;
    } else {
        return false;
    }
};

const matchPaths = (paths, filesChanged) => {
    for (const file of filesChanged) {
        for (const path of paths) {
            // TODO maybe support negative paths?
            if (matchPath(path, file)) {
                return true;
            }
        }
    }
    return false;
};

const skipText = chalk.dim;
const errorText = chalk.red;
const workflowText = chalk.cyan;
const jobText = chalk.yellow;
const stepText = chalk.yellow;

/*::
import type {Job, Step, Workflow} from '../lib/workflow-preprocessor';
*/

const getJobs = (template, trigger, type, filesChanged) => {
    const raw = fs.readFileSync(template, 'utf8');
    /* flow-uncovered-block */
    const data /*: Workflow*/ = /*:: (*/ yaml.safeLoad(raw) /* :: :any) */;
    /* end flow-uncovered-block */
    if (
        !data.on ||
        (Array.isArray(data.on)
            ? !data.on.includes(trigger)
            : !data.on[trigger] ||
              (data.on[trigger].paths &&
                  !matchPaths(data.on[trigger].paths, filesChanged)))
    ) {
        debug(
            skipText(
                `[workflow:${workflowText(
                    path.basename(template),
                )}] Skipping, no changed paths ${trigger} ${JSON.stringify(
                    data.on,
                )}`,
            ),
        );
        return [];
    }
    const jobs = Object.keys(data.jobs)
        .filter((jobId) => matches(jobId, type))
        .map((jobId) => ({
            id: jobId,
            ...data.jobs[jobId],
        }))
        .map((job) => ({ ...job, workflowPath: path.basename(template) }));
    if (jobs.length === 0) {
        debug(
            skipText(
                `[workflow:${workflowText(
                    path.basename(template),
                )}] No jobs matched '${type}'`,
            ),
        );
    } else {
        debug(
            `[workflow:${workflowText(path.basename(template))}] ${
                jobs.length
            } ${plural(jobs.length, 'job', 'jobs')}`,
        );
    }
    return jobs;
};

const normalizePaths = (paths /*: string | Array<string> */) =>
    typeof paths === 'string' ? [paths] : paths;

const indent = (text /*: string*/) => {
    return '|  ' + text.replace(/\n(?!$)/g, '\n|  ');
};

const countInstances = (rx, text /*:string*/) => {
    let num = 0;
    text.replace(rx, () => {
        num += 1;
        return '';
    });
    return num;
};

const runStep = async (step /*: Step*/, filesChanged) => {
    if (step.local === false) {
        return;
    }
    if (step.paths) {
        if (!matchPaths(normalizePaths(step.paths), filesChanged)) {
            debug(
                skipText(
                    `${stepText(`[step]`)} Skipping ${
                        step.name
                    }: no matching paths`,
                ),
            );
            return;
        }
    }
    if (step.local_env_flag) {
        const flag = step.local_env_flag;
        if (!process.env[flag]) {
            console.log(
                skipText(
                    `${stepText(`[step]`)} Skipping step "${
                        step.name
                    }" because env flag ${flag} is missing.`,
                ),
            );
            return;
        }
    }
    if (!step.run && !step.uses) {
        debug(
            skipText(
                `${stepText(`[step]`)} Skipping non-run non-uses step ${
                    step.name
                }`,
            ),
        );
    }
    console.log(stepText(`[step]`), step.name || step.uses || step.run);

    if (step.run) {
        const cwd = step['working-directory']
            ? path.resolve(workspace, step['working-directory'])
            : workspace;
        await runBash(step.run, cwd);
    } else if (step.uses) {
        await runUses(workspace, step.uses.replace('@', '#'), step.with);
    }
};

const runBash = async (run, cwd) => {
    console.log(`${chalk.magenta('$')} ${run}`);

    return await new Promise((resolve, reject) => {
        const proc = spawn(run, [], {
            shell: true,
            cwd,
            /* flow-uncovered-block */
            env: {
                ...process.env,
                // So any actions using `chalk` will still colorize for us
                FORCE_COLOR: 1,
            },
            /* end flow-uncovered-block */
        });

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
                resolve({ errors, failed: false });
            } else {
                console.log(`child process exited with code ${code}`);
                resolve({ errors, failed: true });
            }
        });
    });
};

const runJobs = async (jobs, filesChanged) => {
    let errors = 0;
    for (const job of jobs) {
        // NOTE(jared): For some reason flow has a parser error if I put this
        // string directly in the `console.log` call?????
        const message = `🚜  Running job ${workflowText(
            job.workflowPath,
        )}:${jobText(job.id)}`;
        console.log(message);
        for (const step of job.steps) {
            const result = await runStep(step, filesChanged);
            if (!result) {
                continue;
            }
            if (result.failed) {
                console.error(
                    chalk.red(`---- ❌ Job ${jobText(job.id)} Failed ----`),
                );
                errors += 1;
                break;
            }
            errors += result.errors;
        }
        if (errors === 0) {
            console.log(`✅  Finished job ${jobText(job.id)}`);
        } else {
            console.log(
                `❗ Finished job ${jobText(job.id)} with ${errors} ${plural(
                    errors,
                    'issue',
                    'issues',
                )}`,
            );
        }
        console.log();
    }
    return errors;
};

const runType = async (type, filesChanged, verbose) => {
    console.log(chalk.green(`----- Running jobs matching '${type}' -----`));
    const workflowDir = path.resolve(workspace, '.github/workflow-templates');
    const allJobs = [];
    fs.readdirSync(workflowDir)
        .filter((name) => name.endsWith('.yml') && !name.startsWith('_'))
        .forEach((fileName) => {
            const jobs = getJobs(
                path.resolve(workflowDir, fileName),
                'pull_request',
                type,
                filesChanged,
            );
            allJobs.push(...jobs);
        });

    if (!allJobs.length) {
        console.error(errorText(`No jobs matching ${type}`));
        console.log();
        return 0;
    } else {
        console.log();
        return runJobs(allJobs, filesChanged);
    }
};

const run = async (types) => {
    const startTime = Date.now();
    let baseRef = await getBaseRef();
    if (!baseRef) {
        console.error(
            chalk.yellow(`Warning: `) +
                `Unable to determine the base ref for this branch. Using HEAD`,
        );
        baseRef = 'HEAD';
    }
    process.env.GITHUB_BASE_REF = baseRef;
    const filesChanged = (await gitChangedFiles(baseRef, workspace)).map(
        (fullpath) => path.relative(workspace, fullpath),
    );
    let errors = 0;
    for (const type of types) {
        errors += await runType(type, filesChanged);
    }
    const time = `Finished in ${(Date.now() - startTime) / 1000}s`;
    if (errors === 0) {
        console.log(chalk.green(`✅  All clear! ${time}  ✅`));
    } else {
        console.log(
            chalk.green(
                `❌  ${errors} ${plural(
                    errors,
                    'issue',
                    'issues',
                )} found. ${time}  ❌`,
            ),
        );
        process.exit(1);
    }
};

const opts /*: {[key: string]: true}*/ = {};
const args /*: Array<string>*/ = [];
process.argv.slice(2).forEach((arg, i) => {
    if (arg.startsWith('-')) {
        opts[arg] = true;
    } else {
        args.push(arg);
    }
});

const typeAliases /*:{[key: string]: Array<string>}*/ = {
    test: ['unit'],
    'test:long': ['unit:long'],
    prepare: ['autofix', 'lint', 'unit'],
    pr: ['autofix', 'lint', 'unit'],
};

if (args.includes('help') || opts['-h'] || opts['--help']) {
    console.log(`Github Actions Runner: usage run.js -v [job-suffix] [job-suffix]

Aliases:
${Object.keys(typeAliases)
        .map((key) => `- ${key}: ${typeAliases[key].join(' ')}`)
        .join('\n')}
`);
    process.exit(1);
}

_verbose = opts['-v'] || opts['--verbose'];

const types = [];
args.forEach((arg) => {
    if (typeAliases[arg]) {
        types.push(...typeAliases[arg]);
    } else {
        types.push(arg);
    }
});

if (!types.length) {
    types.push(...typeAliases['prepare']);
}

// flow-next-uncovered-line
run(types).catch((err) => {
    console.error(
        chalk.red('An unexpected error occurred! Please report this bug.'),
    );
    console.error(err); // flow-uncovered-line
    process.exit(1);
});
