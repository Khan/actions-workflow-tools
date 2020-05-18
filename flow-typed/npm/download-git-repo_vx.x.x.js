// flow-typed signature: 4161486fa8561bb92fba8ae1f709f1d2
// flow-typed version: <<STUB>>/download-git-repo_v3.0.2/flow_v0.92.1

/**
 * This is an autogenerated libdef stub for:
 *
 *   'download-git-repo'
 *
 * Fill this stub out by replacing all the `any` types.
 *
 * Once filled out, we encourage you to share your work with the
 * community by sending a pull request to:
 * https://github.com/flowtype/flow-typed
 */

declare module 'download-git-repo' {
    declare type Download = (string, string, (err: ?Error) => void) => void;
    declare module.exports: Download;
}
