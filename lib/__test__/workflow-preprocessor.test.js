// @flow

const {compileSteps, compilePaths} = require('../workflow-preprocessor');
const yaml = require('js-yaml');

const fixtures = [
    {
        title: 'Basic example',
        inputFile: `
setup:
    checkout:
    - run: echo checkout

jobs:
    one:
        steps:
        - name: hi
          setup: checkout
          paths: "*.js"
          run: echo hi
`,
        outputJobs: {
            one: {
                steps: [
                    {
                        run: 'echo checkout',
                        name: '▶️ Setup checkout: undefined',
                    },
                    compilePaths('paths__js', ['*.js']),
                    {
                        name: 'hi',
                        run: 'echo hi',
                        if: `steps.paths__js.outputs.changed == 'true'`,
                    },
                ],
            },
        },
    },

    {
        title: 'Multiple dependencies with different paths',
        inputFile: `
setup:
    checkout:
    - run: echo checkout
    
    one:
    - run: echo one

    two:
        setup: one
        steps:
        - run: echo two

jobs:
    a_job:
        setup: checkout
        steps:
        - name: first
          paths: "*.js"
          setup: two
          run: echo first
        - name: second
          paths: "*.java"
          setup: two
          run: echo second
        `,
        outputJobs: {
            a_job: {
                steps: [
                    {
                        run: 'echo checkout',
                        name: '▶️ Setup checkout: undefined',
                    },
                    compilePaths('paths__js', ['*.js']),
                    compilePaths('paths__java', ['*.java']),
                    {
                        name: '▶️ Setup one: undefined',
                        run: 'echo one',
                        if: `steps.paths__js.outputs.changed == 'true' || steps.paths__java.outputs.changed == 'true'`,
                    },
                    {
                        name: '▶️ Setup two: undefined',
                        run: 'echo two',
                        if: `steps.paths__js.outputs.changed == 'true' || steps.paths__java.outputs.changed == 'true'`,
                    },
                    {
                        name: 'first',
                        run: 'echo first',
                        if: `steps.paths__js.outputs.changed == 'true'`,
                    },
                    {
                        name: 'second',
                        run: 'echo second',
                        if: `steps.paths__java.outputs.changed == 'true'`,
                    },
                ],
            },
        },
    },
    {
        title: 'Bail unless',
        inputFile: `
setup:
    checkout:
    - run: echo checkout

jobs:
    one:
        steps:
        - uses: Khan/pull-request-comment-trigger@1.0.0
          bail_if: outputs.triggered != 'true'
          with:
            trigger: '#build/android'

        - name: hi
          setup: checkout
          paths: "*.js"
          run: echo hi
`,
        outputJobs: {
            one: {
                steps: [
                    {
                        uses: 'Khan/pull-request-comment-trigger@1.0.0',
                        with: {trigger: '#build/android'},
                        id: 'bail_if_1',
                    },
                    {
                        run: 'echo checkout',
                        name: '▶️ Setup checkout: undefined',
                        if: `!(steps.bail_if_1.outputs.triggered != 'true')`,
                    },
                    {
                        ...compilePaths('paths__js', ['*.js']),
                        if: `!(steps.bail_if_1.outputs.triggered != 'true')`,
                    },
                    {
                        name: 'hi',
                        run: 'echo hi',
                        if: `(!(steps.bail_if_1.outputs.triggered != 'true')) && (steps.paths__js.outputs.changed == 'true')`,
                    },
                ],
            },
        },
    },
];

/*::
import type {Workflow} from '../workflow-preprocessor'
*/

describe('Workflow preprocessor', () => {
    fixtures.forEach(fixture => {
        it(fixture.title, () => {
            /* flow-uncovered-block */
            const data /*: Workflow */ = /*:: (*/ yaml.safeLoad(
                fixture.inputFile,
            ) /*:: : any)*/;
            /* end flow-uncovered-block */
            for (const jobId of Object.keys(data.jobs)) {
                compileSteps(data.jobs[jobId], data.setup || {});
            }
            // For debugging
            // console.log(yaml.safeDump(data.jobs))
            expect(data.jobs).toEqual(fixture.outputJobs);
        });
    });
});
