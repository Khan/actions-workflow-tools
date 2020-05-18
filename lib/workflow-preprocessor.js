// @flow
/**
 * Here's the magic! Github's workflow syntax leaves a bit to be disired,
 * so this makes up the difference.
 *
 * # Major additions:
 *
 * ## Setup dependencies
 *
 * This allows you to re-use steps between jobs and workflows!
 *
 * ## Paths support for individual steps!
 *
 * This allows you conditionally run steps based on the files that you've
 * changed. And the path configuration applies transitively to any setup
 * dependencies, keeping things as streamlined as possible.
 *
 * ## Bail early, without failing the job!
 *
 * Say you want to only run a job if a certain condition matches, that's more
 * complex than can be handled by the workflow's `on` attribute?
 * Now you can add `bail_if` to a step, and if that condition evaluates to
 * false, all subsequent steps will be *skipped*, and the job will succeed.
 *
 * # Syntax example:
 *
 * ```yaml
 * setup:
 *   some-thing:
 *     setup: [other-thing]  ## setups can depend on each other!
 *     steps:
 *     - name: hello
 *       run: echo "hello"
 *
 * jobs:
 *   some-job:
 *     setup: [install-ruby-gems] ## a job dependency!
 *     steps:
 *     - name: should happen every time
 *     - name: needs other thing
 *       setup: [other-thing]     ## yay step dependencies
 *       ...
 *     - name: only if javascript files are modified
 *       paths: *.js              ## this step only happens if js files changed
 *       setup: [node]            ## same with this setup step!
 * ```
 */

const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

const setupList = (setup /*: ?(string | Array<string>) */) /*:Array<string>*/ =>
    setup ? (Array.isArray(setup) ? setup : [setup]) : [];

/// https://en.wikipedia.org/wiki/Topological_sorting#Algorithms
/**
 * This is a "topological sort" algorithm, that allows us to take a graph (in
 * this case, of "steps", "setups", "paths" and the dependencies between them),
 * and find a linearization that respects all of the dependencies.
 *
 * e.g.
 * A depends on B
 * B depends on C
 * A depends on D
 * C depends on D
 * C depends on E
 *
 * could give us A, B, C, D, E as a valid linearization.
 */
const kahnsAlgorithm = (
    nodes /*:{[key: string]: Node} */,
) /*: Array<string>*/ => {
    // L ← Empty list that will contain the sorted elements
    // S ← Set of all nodes with no incoming edge
    // while S is non-empty do
    //     remove a node n from S
    //     add n to tail of L
    //     for each node m with an edge e from n to m do
    //         remove edge e from the graph
    //         if m has no other incoming edges then
    //             insert m into S
    // if graph has edges then
    //     return error   (graph has at least one cycle)
    // else
    //     return L   (a topologically sorted order)
    // const edges = {...inputEdges};
    const L = [];
    const S = [];
    for (const id of Object.keys(nodes)) {
        if (Object.keys(nodes[id].before).length === 0) {
            S.push(id);
        }
    }
    while (S.length) {
        const nodeId = S.shift();
        L.push(nodeId);
        for (const afterId of Object.keys(nodes[nodeId].after)) {
            delete nodes[nodeId].after[afterId];
            delete nodes[afterId].before[nodeId];
            if (Object.keys(nodes[afterId].before).length === 0) {
                S.push(afterId);
            }
        }
    }
    const edgesLeft = [];
    for (const nodeId of Object.keys(nodes)) {
        const afterIds = Object.keys(nodes[nodeId].after);
        if (afterIds.length) {
            afterIds.forEach((id) => edgesLeft.push(`${nodeId}:${id}`));
        }
    }
    if (edgesLeft.length) {
        throw new Error(`Cycle in setup dependencies: ${edgesLeft.join(', ')}`);
    }
    return L;
};

/**
 * This creates a step that will check to see if any of the "paths" patterns
 * are matched by changed files. It attempts to support a subset of minimatch
 * syntax, but that is not guaranteed. You should check the outputted regex
 * to ensure that it's doing what you expect.
 *
 * The translation is:
 * - `**` or `**` + `/*` -> `.*`
 * - `*` -> `[^\/]*`
 */
const compilePaths = (id /*:string*/, paths /*:Array<string>*/) /*: Step*/ => {
    return {
        id,
        name: 'Check paths: ' + paths.join(', '),
        run:
            paths
                .map((pattern) => {
                    pattern = pattern
                        .replace(/\./g, '\\.')
                        .replace(/(\*\*\/\*)|\*+/g, (matched) => {
                            if (matched === '**/*') {
                                return '.*';
                            } else if (matched.length === 1) {
                                return `[^/]*`;
                            } else if (matched.length === 2) {
                                return `.*`;
                            } else {
                                throw new Error(
                                    `Invalid pattern: ${pattern} - only * and ** replacements are supported`,
                                );
                            }
                        });
                    return `if [[ -n $(git diff --name-only refs/remotes/origin/$GITHUB_BASE_REF --relative | grep '^${pattern}$') ]]
then
echo "::set-output name=changed::true"
exit 0
fi`;
                })
                .join('\n\n') +
            `
echo "::set-output name=changed::false"
exit 0`,
    };
};

const addEdge = (ctx, parentKey, childKey) => {
    ctx.nodes[parentKey].before[childKey] = true;
    ctx.nodes[childKey].after[parentKey] = true;
};

/*::

export type Job = {
    'runs-on': string,
    setup?: string | Array<string>,
    steps: Array<Step>,
}
export type Step = {
    id?: string,
    local?: boolean,
    setup?: string | Array<string>,
    paths?: Array<string> | string,
    uses?: string,
    with?: {[key: string]: string},
    if?: string,
    bail_if?: string,
    local_env_flag?: string,
    run?: string,
    name: string,
    'working-directory'?: string,
}

export type Setup = Array<Step> | {
    setup?: string | Array<string>,
    steps: Array<Step>,
}

export type Workflow = {
    name: string,
    include?: Array<string>,
    setup?: {[key: string]: Setup},
    on?: {[key: string]: {paths?: Array<string>}},
    jobs: {
        [key: string]: Job
    }
}

type SetupSteps = {[key: string]: Setup};
type NodeContent = {
    type: 'paths',
    paths: Array<string>,
} | {
    type: 'step',
    step: Step,
} | {
    type: 'setup',
    setup: Setup,
}
type Node = {|
    id: string,
    contents: NodeContent,
    pathDeps: ?{[key: string]: boolean},
    before: {[key: string]: true},
    after: {[key: string]: true},
|};
type Context = {
    nodes: {[key: string]: Node},
    setupSteps: SetupSteps,
}
*/

const addNode = (
    ctx /*: Context*/,
    id,
    contents /*:NodeContent*/,
    pathIds /*:Array<string>*/,
) => {
    if (ctx.nodes[id]) {
        return;
    }
    let pathDeps = null;
    if (pathIds.length) {
        const deps = {};
        pathIds.forEach((id) => (deps[id] = true));
        pathDeps = deps;
    }
    ctx.nodes[id] = {
        id,
        contents,
        pathDeps,
        before: {},
        after: {},
    };
    pathIds.forEach((pathId) => addEdge(ctx, id, pathId));
};

const processSetup = (
    ctx,
    parentKey,
    setup /*:?(string|Array<string>)*/,
    pathIds,
) => {
    setupList(setup).forEach((id) => {
        const childKey = addSetup(ctx, id, pathIds);
        addEdge(ctx, parentKey, childKey);
    });
};

const addPaths = (ctx /*: Context*/, paths /*: string | Array<string> */) => {
    paths = typeof paths === 'string' ? [paths] : paths.slice();
    paths.sort();
    const pathsId = `paths-` + paths.join('#');
    addNode(ctx, pathsId, { type: 'paths', paths }, []);
    return pathsId;
};

const propagatePaths = (ctx, key, pathIds) => {
    if (!pathIds.length) {
        // If this node is being included unconditionally, remove any conditions.
        ctx.nodes[key].pathDeps = null;
    } else {
        const pathDeps = ctx.nodes[key].pathDeps;
        if (pathDeps) {
            pathIds.forEach((pathId) => {
                pathDeps[pathId] = true;
                addEdge(ctx, key, pathId);
            });
        }
    }
    Object.keys(ctx.nodes[key].before).forEach((key) => {
        propagatePaths(ctx, key, pathIds);
    });
};

const addSetup = (ctx /*: Context*/, setupId, pathIds) => {
    const key = `setup-${setupId}`;
    if (key === 'setup-checkout') {
        pathIds = [];
    }
    if (ctx.nodes[key]) {
        propagatePaths(ctx, key, pathIds);
        return key;
    }
    addNode(
        ctx,
        key,
        { type: 'setup', setup: ctx.setupSteps[setupId] },
        pathIds,
    );
    if (!ctx.setupSteps[setupId]) {
        throw new Error(`Invalid setupId: ${setupId}`);
    }
    if (!Array.isArray(ctx.setupSteps[setupId])) {
        processSetup(ctx, key, ctx.setupSteps[setupId].setup, pathIds);
    }
    return key;
};

const andIfs = (one /*:string*/, two /*:string*/) => `(${one}) && (${two})`;

const maybeAddIf = (iff /*:?string*/, step /*:Step*/) => {
    if (!iff) {
        return step;
    }
    if (step.if) {
        iff = andIfs(iff, step.if);
    }
    return { ...step, if: iff };
};

const assignedPathIds /*:{[key: string]: Array<string>}*/ = {};
const makePathsId = (paths /*:Array<string>*/) => {
    const text =
        'paths_' + paths.map((path) => path.replace(/\W+/g, '_')).join('__');
    let num = 0;
    // At some point we just give up
    while (num < 1000) {
        const key = num === 0 ? text : `${text}-${num}`;
        if (!assignedPathIds[key]) {
            assignedPathIds[key] = paths;
            return key;
        }
        const prev = assignedPathIds[key];
        if (
            prev.length === paths.length &&
            prev.every((item, i) => item === paths[i])
        ) {
            return key;
        }
        num += 1;
    }
    throw new Error("This can't happen");
};

const compileIf = (deps /*: ?{[key: string]: boolean}*/, ids) => {
    if (!deps) {
        return null;
    }
    return Object.keys(deps)
        .map((paths) => `steps.${ids[paths]}.outputs.changed == 'true'`)
        .join(' || ');
};

const processBailUnless = (steps) => {
    const bails = steps.filter((step) => !!step.bail_if);
    if (!bails.length) {
        return;
    }
    bails.forEach((bail, i) => {
        if (!bail.id) {
            bail.id = `bail_if_${i + 1}`;
        }
        if (!bail.bail_if) {
            return;
        }
        const cond =
            '!(' +
            bail.bail_if.replace(
                /(?<!\.)outputs\./g,
                `steps.${bail.id}.outputs.`,
            ) +
            ')';
        delete bail.bail_if;
        steps.slice(steps.indexOf(bail) + 1).forEach((step) => {
            step.if = step.if ? andIfs(cond, step.if) : cond;
        });
    });
};

const compileSteps = (job /*: Job */, setupSteps /*: SetupSteps */) => {
    const nodes /*: {[key: string]: Node}*/ = {};
    const ctx /*:Context*/ = { nodes, setupSteps };

    job.steps.forEach((step, i) => {
        const key = `step-${i}`;
        const pathIds = step.paths ? [addPaths(ctx, step.paths)] : [];
        addNode(ctx, key, { type: 'step', step }, pathIds);
        processSetup(ctx, key, step.setup, pathIds);
        delete step.setup;
        delete step.paths;
        delete step.local;
        delete step.local_env_flag;
        if (i > 0) {
            addEdge(ctx, `step-${i}`, `step-${i - 1}`);
        }
    });
    processSetup(ctx, 'step-0', job.setup, []);
    delete job.setup;

    for (const nodeId of Object.keys(nodes)) {
        if (nodes[nodeId].contents.type === 'paths') {
            if (!ctx.nodes['setup-checkout']) {
                throw new Error(
                    'You must have a "checkout" setup if you are using step- or job-level paths',
                );
            }
            addEdge(ctx, nodeId, 'setup-checkout');
        }
    }

    const ordering = kahnsAlgorithm(nodes);
    const pathsMap /*:{[key: string]:string}*/ = {};
    const steps = [];

    ordering.forEach((id) => {
        const item = nodes[id].contents;
        const pathsIf = compileIf(nodes[id].pathDeps, pathsMap);
        if (item.type === 'paths') {
            pathsMap[id] = makePathsId(item.paths);
            steps.push(compilePaths(pathsMap[id], item.paths));
            // pass
        } else if (item.type === 'setup') {
            const name = id.slice('setup-'.length);
            const itemSteps = Array.isArray(item.setup)
                ? [...item.setup]
                : !item.setup.steps
                    ? null
                    : [...item.setup.steps];
            if (!itemSteps) {
                // do nothing
            } else if (itemSteps.length === 1) {
                steps.push(
                    maybeAddIf(pathsIf, {
                        ...itemSteps[0],
                        name: `▶️ Setup ${name}: ${itemSteps[0].name || ''}`,
                    }),
                );
            } else {
                steps.push(
                    maybeAddIf(pathsIf, {
                        name: `🔽 Start setup [${name}]`,
                        run: 'echo "Setting something up"',
                    }),
                );
                steps.push(
                    ...itemSteps.map((step) => maybeAddIf(pathsIf, step)),
                );
                steps.push(
                    maybeAddIf(pathsIf, {
                        name: `🔼 Finished setup [${name}]`,
                        run: 'echo "Finished setting it up"',
                    }),
                );
            }
        } else {
            steps.push(maybeAddIf(pathsIf, item.step));
        }
    });

    processBailUnless(steps);

    job.steps = steps;
};

const processFile = (infile /*:string*/, outfile /*:string*/) => {
    console.log(chalk.dim(`Processing ${infile}`));
    const raw = fs.readFileSync(infile, 'utf8');
    // flow-next-uncovered-line
    const data /*: Workflow */ = /*:: (*/ yaml.safeLoad(raw) /*:: :any)*/;
    if (!data || !data.jobs) {
        throw new Error(`Not a valid workflow file ${infile}`);
    }

    const directory = path.dirname(infile);
    if (data.include) {
        data.setup = { ...data.setup }; // flow-uncovered-line
        data.include.forEach((other) => {
            const otherFull = path.resolve(directory, other);
            if (!fs.existsSync(otherFull)) {
                throw new Error(
                    `Included file ${other} not found (from ${infile})`,
                );
            }
            const raw = fs.readFileSync(otherFull, 'utf8');
            /* flow-uncovered-block */
            const parsed /*: Workflow */ = /*:: (*/ yaml.safeLoad(
                raw,
            ) /*:: :any)*/;
            Object.assign(data.setup, parsed.setup);
            /* end flow-uncovered-block */
        });
        delete data.include;
    }

    const setupSteps = data.setup || {};
    delete data.setup;
    for (const jobId of Object.keys(data.jobs)) {
        compileSteps(data.jobs[jobId], setupSteps);
    }
    const relativeInfile = path.relative(
        path.resolve(__dirname, '../../'),
        infile,
    );
    fs.writeFileSync(
        outfile,
        `# AUTOGENERATED by action-preprocessor.js from ${relativeInfile}

` + yaml.safeDump(data, { noRefs: true }),
    );
};

module.exports = { processFile, compileSteps, compilePaths };
