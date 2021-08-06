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
const {execSync} = require('child_process');
const topLevel = execSync('git rev-parse --show-toplevel')
    .toString('utf8')
    .trim();
const {runUses} = require('../lib/uses');
const {runProcess} = require('../lib/utils');

const gitChangedFiles = require('actions-utils/git-changed-files');
const getBaseRef = require('actions-utils/get-base-ref');

let _verbose = false;

const debug = (...args) => {
    if (_verbose) {
        console.log(...args);
    }
};

const plural = (num, single, plural) => (num === 1 ? single : plural);

// Match a job id, or a subset of a job id
// so `lint` will match `lint_and_unit`, but not `flint`
const matches = (jobId /* :string*/, type) => {
    return !!jobId.match(new RegExp('(^|[^a-zA-Z0-9])' + type + '($|[^a-zA-Z0-9])', 'i'));
};

function escapeRegExp(string /*: string*/) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

const matchPath = (path /*: string*/, file) => {
    const rxString =
        '^' +
        escapeRegExp(path).replace(/(\\\*\\\*\/\\\*|(:?\\\*)+)/g, matched => {
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

const loadWorkflow = fileName => {
    const raw = fs.readFileSync(fileName, 'utf8');
    /* flow-uncovered-block */
    const data /*: Workflow*/ = /*:: (*/ yaml.safeLoad(raw) /* :: :any) */;
    /* end flow-uncovered-block */
    return data;
};

const getJobs = (template, trigger, type, filesChanged) => {
    const data = loadWorkflow(template);
    if (
        !data.on ||
        (Array.isArray(data.on)
            ? !data.on.includes(trigger)
            : !data.on[trigger] ||
              (data.on[trigger].paths && !matchPaths(data.on[trigger].paths, filesChanged)))
    ) {
        debug(
            skipText(
                `[workflow:${workflowText(
                    path.basename(template),
                )}] Skipping, no changed paths ${trigger} ${JSON.stringify(data.on) || ''}`,
            ),
        );
        return [];
    }
    const jobs = Object.keys(data.jobs)
        .filter(jobId => matches(jobId, type))
        .map(jobId => ({
            id: jobId,
            ...data.jobs[jobId],
        }))
        .map(job => ({...job, workflowPath: path.basename(template)}));
    if (jobs.length === 0) {
        debug(
            skipText(
                `[workflow:${workflowText(path.basename(template))}] No jobs matched '${type}'`,
            ),
        );
    } else {
        debug(
            `[workflow:${workflowText(path.basename(template))}] ${jobs.length} ${plural(
                jobs.length,
                'job',
                'jobs',
            )}`,
        );
    }
    return jobs;
};

const normalizePaths = (paths /*: string | Array<string> */) =>
    typeof paths === 'string' ? [paths] : paths;

const runStep = async (step /*: Step*/, filesChanged) => {
    if (step.local === false) {
        return;
    }
    if (step.paths) {
        if (!matchPaths(normalizePaths(step.paths), filesChanged)) {
            debug(skipText(`${stepText(`[step]`)} Skipping ${step.name}: no matching paths`));
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
        debug(skipText(`${stepText(`[step]`)} Skipping non-run non-uses step ${step.name}`));
    }
    console.log(stepText(`[step]`), step.name || step.uses || step.run);

    if (step.run) {
        const workingDir = step['working-directory']
            ? path.resolve(topLevel, step['working-directory'])
            : topLevel;

        return runBash(step.run, workingDir);
    } else if (step.uses) {
        const cacheDir = step['local_cache_directory']
            ? path.resolve(topLevel, step['local_cache_directory'])
            : topLevel;

        return runUses(topLevel, cacheDir, step.uses.replace('@', '#'), step.with);
    }
};

const runBash = async (run, cwd) => {
    console.log(`${chalk.magenta('$')} ${run}`);

    return await runProcess(run, [], {
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
};

const runJobs = async (jobs, filesChanged) => {
    let errors = 0;
    for (const job of jobs) {
        // NOTE(jared): For some reason flow has a parser error if I put this
        // string directly in the `console.log` call?????
        const message = `🚜  Running job ${workflowText(job.workflowPath)}:${jobText(job.id)}`;
        console.log(message);
        for (const step of job.steps) {
            const result = await runStep(step, filesChanged);
            if (!result) {
                continue;
            }
            if (result.failed) {
                console.error(chalk.red(`---- ❌ Job ${jobText(job.id)} Failed ----`));
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

/**
 * Fuzzy match to find the step you want.
 * If your input directly matches a step's `id`, go with that.
 * Otherwise, fuzzy match on the "step repo" for steps that use a repo.
 */
const findStepsInWorkflow = (workflow, needle, exact, verbose) => {
    const needleRegexp = new RegExp('\\b' + escapeRegExp(needle) + '\\b', 'i');
    const steps = [];
    Object.keys(workflow.jobs).forEach(jobId => {
        if (verbose) {
            console.log(skipText(`Checking job ${jobId}`));
        }
        workflow.jobs[jobId].steps.forEach(step => {
            if (verbose) {
                console.log(
                    skipText(`Checking step [${step.id || 'no id'}] ${step.name || 'no name'}`),
                );
            }
            if (exact) {
                if (step.id === needle || step.name === needle) {
                    steps.push({sort: 0, step});
                }
            } else if (needleRegexp.test(step.id || '') || needleRegexp.test(step.name || '')) {
                steps.push({sort: 0, step});
            } else if (step.uses) {
                const repo = step.uses.split('@')[0];
                const [_owner, name] = repo.split('/');
                if (repo.toLowerCase() === needle.toLowerCase()) {
                    steps.push({sort: 1, step});
                } else if (name.toLowerCase() === needle.toLowerCase()) {
                    steps.push({sort: 2, step});
                } else if (name.toLowerCase().startsWith(needle.toLowerCase())) {
                    // sort is better for shorter names, because the needle will have
                    // matched more of it
                    steps.push({sort: 2 + name.length, step});
                }
            }
        });
    });
    return steps;
};

const findNamedSteps = (name, exact, verbose) => {
    const workflowDir = path.resolve(topLevel, '.github/workflow-templates');
    const steps = [];

    const parts = name.split(':');
    if (parts.length === 2 && parts[0].endsWith('.yml')) {
        console.log('yep', parts[0]);
        const data = loadWorkflow(path.join(workflowDir, parts[0]));
        steps.push(...findStepsInWorkflow(data, parts[1], exact, verbose));
    } else {
        fs.readdirSync(workflowDir)
            .filter(name => name.endsWith('.yml') && !name.startsWith('_'))
            .forEach(fileName => {
                const data = loadWorkflow(path.join(workflowDir, fileName));
                steps.push(...findStepsInWorkflow(data, name, exact, verbose));
            });
    }
    return steps;
};

const getJobsWithAlaises = args => {
    const types = [];
    args.forEach(arg => {
        if (typeAliases[arg]) {
            types.push(...typeAliases[arg]);
        } else {
            types.push(arg);
        }
    });

    if (!types.length) {
        types.push(...typeAliases['prepare']);
    }

    return types;
};

const runSteps = async (steps, name, all, filesChanged) => {
    if (all) {
        let allErrors = 0;
        for (const {step} of steps) {
            const result = await runStep(step, filesChanged);
            if (result) {
                allErrors += result.errors;
            }
        }
        return allErrors;
    }

    // lower sort is better
    steps.sort((a, b) => a.sort - b.sort);
    if (steps.length > 1) {
        console.log(
            skipText(
                `${
                    steps.length
                } steps found matching ${name}, selecting the best match. To run a particular step, use --exact, and specify the full name of the step. Alternatively, use --all to run all matching steps.`,
            ),
        );
        console.log(skipText('All matching steps:'));
        steps.forEach(({step}, i) => {
            console.log(skipText(`- ${step.name}`, i === 0 ? chalk.green('(selected)') : ''));
        });
    }
    const result = await runStep(steps[0].step, filesChanged);
    if (!result) {
        return 0;
    }
    return result.errors;
};

const getJobsByType = (type, filesChanged) => {
    const workflowDir = path.resolve(topLevel, '.github/workflow-templates');
    const allJobs = [];
    fs.readdirSync(workflowDir)
        .filter(name => name.endsWith('.yml') && !name.startsWith('_'))
        .forEach(fileName => {
            const jobs = getJobs(
                path.resolve(workflowDir, fileName),
                'pull_request',
                type,
                filesChanged,
            );
            allJobs.push(...jobs);
        });
    return allJobs;
};

const run = async (args, opts) => {
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
    const filesChanged = (await gitChangedFiles(baseRef, topLevel)).map(fullpath =>
        path.relative(topLevel, fullpath),
    );

    let errors = 0;

    if (args[0] === 'job' || !args.length) {
        for (const type of getJobsWithAlaises(args.slice(1))) {
            const jobs = getJobsByType(type, filesChanged);
            console.log(chalk.green(`----- Running ${jobs.length} jobs matching '${type}' -----`));
            console.log();
            errors += await runJobs(jobs, filesChanged);
        }
    } else {
        const name = args.join(' '); // so you can say `git actions flow coverage` and it will work
        const steps /*:Array<{sort: number, step: Step}>*/ = findNamedSteps(
            name,
            opts['--exact'],
            _verbose,
        );
        if (steps.length) {
            errors += await runSteps(steps, name, opts['--all'], filesChanged);
        } else {
            console.error(skipText(`No steps matching ${name}, checking for jobs`));
            const jobs = getJobsByType(name, filesChanged);
            if (jobs.length) {
                console.log(chalk.green(`Found ${jobs.length} for ${name}`));
                console.log();
                errors += await runJobs(jobs, filesChanged);
            } else {
                console.error(skipText(`No steps or jobs matching ${name}`));
                console.log();
                errors += 1;
            }
        }
    }

    const time = `Finished in ${(Date.now() - startTime) / 1000}s`;
    if (errors === 0) {
        console.log(chalk.green(`✅  All clear! ${time}  ✅`));
    } else {
        console.log(
            chalk.green(`❌  ${errors} ${plural(errors, 'issue', 'issues')} found. ${time}  ❌`),
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
        .map(key => `- ${key}: ${typeAliases[key].join(' ')}`)
        .join('\n')}

Running individual steps: step {options} [step-id-or-name-substring]
Options:
    --all       run all steps that match the substring instead of just the first one
    --exact     match the step id or name exactly

Note that substrings are restricted to word boundaries, e.g. 'flow' won't match 'workflows'.
`);
    process.exit(1);
}

_verbose = opts['-v'] || opts['--verbose'];

// flow-next-uncovered-line
run(args, opts).catch(err => {
    console.error(chalk.red('An unexpected error occurred! Please report this bug.'));
    console.error(err); // flow-uncovered-line
    process.exit(1);
});
