// @flow
/**
 * This ensures that `yarn` has been run so that our github actions scripts work.
 */

const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

if (!fs.existsSync(path.join(__dirname, '../node_modules'))) {
    console.log(
        `Looks like you haven't installed node_modules in .github/actions.`,
    );
    console.log(`Running yarn`);
    execSync('yarn', {
        cwd: path.join(__dirname, '../'),
        stdio: 'inherit',
    });
    console.log('Finished running yarn');
}
