# Actions Workflow Tools

## `yarn make-workflows`
- deduplicate your github actions workflows to share setup steps between jobs
- only run steps if certain files have changed

Create workflows in the `.github/workflow-templates` and `make-workflows` will do the magic for you! See `workflow-preprocessor.js` for details on added functionality.

## `yarn actions`
Run js-based github actions locally!
e.g. `yarn actions step flow-coverage` to run your flow-coverage action, or `yarn actions test` to run all jobs that contain `test` in the id.
