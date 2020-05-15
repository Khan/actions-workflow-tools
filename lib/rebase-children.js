// @flow

/*::
import type {Octokit, Octokit$PullsListResponseItem  as PullRequest} from '@octokit/rest'
*/

const rebaseChildren = async (
    {
        client,
        owner,
        repo,
        pullRequest,
    } /*: {
    client: Octokit,
    owner: string,
    repo: string,
    pullRequest: PullRequest,
}*/,
) => {
    // Get "child" pull-requests.
    const {data: pulls} = await client.pulls.list({
        owner,
        repo,
        base: pullRequest.head.ref,
    });

    if (!pulls.length) {
        console.log(
            `No child pull requests found (that have a base of "${
                pullRequest.head.ref
            }"). Finished`,
        );
        return;
    }

    // For each child pull-request, re-base it onto the parent's base (which
    // now contains the squashed commit of the parent PR), and then merge the
    // new base in to the child PR's branch.
    for (const pull of pulls) {
        console.log(`Updating "${pull.title}" ( ${pull.html_url} )`);
        await client.pulls.update({
            owner,
            repo,
            pull_number: pull.number,
            base: pullRequest.base.ref,
        });
        try {
            await client.pulls.updateBranch({
                owner,
                repo,
                pull_number: pull.number,
            });
            // flow-next-uncovered-line
        } catch (err) {
            // flow-next-uncovered-line
            if (err.status === 422) {
                // merge conflict
                await client.issues.createComment({
                    owner,
                    repo,
                    issue_number: pull.number,
                    body: `The parent pull-request ([#${pullRequest.number}]](${
                        pullRequest.html_url
                    })) has been merged into \`${
                        pullRequest.base.ref
                    }\`, but this branch (\`${
                        pull.head.ref
                    }\`) now has conflicts with the new base branch. These conflicts must be resolved before checks can complete on this pull-request.`,
                });
            }
        }
    }
};

module.exports = rebaseChildren;
