// @flow
/* flow-uncovered-file */

const {BigQuery} = require('@google-cloud/bigquery');
const {Storage} = require('@google-cloud/storage');
const storage = new Storage();
const bucket = storage.bucket('github-actions-mobile');

const androidBundleSizeFile = (hash /*: string*/) =>
    `bundle-size/${hash}-android.txt`;
const apkFileName = (hash /*: string*/) => `build/${hash}-android.apk`;
const apkQrCodeFileName = (hash /*: string*/) => `build/${hash}-android.png`;

/*::
type Sizes = {
  min: number,
  max: number,
  hash: string,
  branch: string,
  date: string,
}
*/

const uploadSizes = async (sizes /*: Sizes */) => {
    console.log(`Uploading sizes for ${sizes.hash}: ${JSON.stringify(sizes)}`);
    await bucket
        .file(androidBundleSizeFile(sizes.hash))
        .save(JSON.stringify(sizes), {resumable: false});
};

const addSizesToBigquery = async (sizes /*: Sizes */) => {
    const bigquery = new BigQuery({
        projectId: 'khanacademy.org:deductive-jet-827',
    });

    // Insert data into a table
    await bigquery
        .dataset('jared')
        .table('mobile_apk_sizes')
        .insert([sizes]);
};

module.exports = {
    uploadSizes,
    apkFileName,
    androidBundleSizeFile,
    bucket,
    apkQrCodeFileName,
    addSizesToBigquery,
};
