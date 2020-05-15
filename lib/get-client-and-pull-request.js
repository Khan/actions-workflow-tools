// @flow

/*::
import {Octokit, type Octokit$PullsGetResponse as PullRequest} from '@octokit/rest'
class GitHub extends Octokit {
    constructor(token: string, opts: {}) {}
}
type Repo = {owner: string, repo: string};
type Context = {
    eventName: 'pull_request',
    repo: Repo,
    payload: {pull_request: PullRequest}
} | {
    eventName: 'issue_comment',
    repo: Repo,
    payload: {issue: {pull_request: ?PullRequest}}
}
*/

const getClientAndInfo = function() {
    if (process.env.GITHUB_TOKEN) {
        const {GITHUB_TOKEN} = process.env;
        /* flow-uncovered-block */
        const {
            GitHub,
            context,
        } /*:{GitHub: typeof GitHub, context: Context}*/ = require('@actions/github');
        /* end flow-uncovered-block */

        const {owner, repo} = context.repo;
        const client = new GitHub(GITHUB_TOKEN, {});
        return {
            client,
            owner,
            repo,
        };
    } else {
        // For trying out locally
        const yaml = require('js-yaml');
        const path = require('path');
        const fs = require('fs');

        const {HOME} = process.env;
        if (!HOME) {
            throw new Error('Cannot get hub auth without a $HOME');
        }

        /* flow-uncovered-block */
        const token /*:string*/ = /*:: (*/ yaml.safeLoad(
            fs.readFileSync(path.join(HOME, '.config', 'hub'), 'utf8'),
        ) /*:: :any)*/['github.com'][0].oauth_token;
        /* end flow-uncovered-block */
        const {execSync} = require('child_process');
        const remote = execSync('git remote get-url origin')
            .toString('utf8')
            .trim();
        const match = remote.match(
            /github\.com(:|\/)([^/]+)\/([^/]+?)(\.git)?$/,
        );
        if (!match) {
            console.error(
                `Could not parse github owner and repo from origin ${remote}`,
            );
            process.exit(1);
            throw new Error('Unreachable');
        }
        const owner = match[2];
        const repo = match[3];
        const {Octokit} = require('@octokit/rest');
        const client = new Octokit({
            auth: `token ${token}`,
        });

        return {owner, repo, client};
    }
};

const getPullRequest = async function(client, owner, repo) {
    if (process.env.GITHUB_TOKEN) {
        /* flow-uncovered-block */
        const {context} /*:{context: Context}*/ = require('@actions/github');
        /* end flow-uncovered-block */

        if (context.eventName === 'issue_comment') {
            if (!context.payload.issue.pull_request) {
                // we're not in a pull request
                throw new Error(
                    `This workflow was triggered by an issue comment, but not on a pull request. Aborting.`,
                );
            }
            return context.payload.issue.pull_request;
        } else {
            return context.payload.pull_request;
        }
    } else {
        const {execSync} = require('child_process');
        const head = execSync('git rev-parse --abbrev-ref HEAD')
            .toString('utf8')
            .trim();
        const [_, __, arg] = process.argv;
        let pullRequest;
        if (!arg) {
            const {data: pulls} = await client.pulls.list({
                owner,
                repo,
                head: `${owner}:${head}`,
            });
            if (!pulls.length) {
                console.error(`No pull requests found for head "${head}"`);
                process.exit(1);
            }
            pullRequest = pulls[0];
            // If the argument is an integer
        } else if (parseInt(arg).toFixed(0) === arg) {
            const result = await client.pulls.get({
                owner,
                repo,
                pull_number: parseInt(arg),
            });
            pullRequest = result.data;
        } else {
            const {data: pulls} = await client.pulls.list({
                owner,
                repo,
                head: `${owner}:${arg}`,
            });
            if (!pulls.length) {
                console.error(`No pull requests found for head "${head}"`);
                process.exit(1);
            }
            pullRequest = pulls[0];
        }

        const {data: richerPullRequest} = await client.pulls.get({
            owner,
            repo,
            pull_number: pullRequest.number,
        });

        return richerPullRequest;
    }
};

const getClientAndPullRequest = async function() /*:Promise<{
    client: Octokit,
    owner: string,
    repo: string,
    pullRequest: PullRequest,
}>*/ {
    const {client, owner, repo} = getClientAndInfo();
    const pullRequest = await getPullRequest(client, owner, repo);
    return {client, owner, repo, pullRequest};
};

module.exports = {getClientAndPullRequest, getClientAndInfo};
