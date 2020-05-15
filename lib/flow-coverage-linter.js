// @flow

const {execSync} = require('child_process');
const path = require('path');

const fs = require('fs');

// Allows text after comment explaining why
const flowUncoveredLineRegex = /(\/\/\s*flow-uncovered-line[\s:]?.*|\/\*\s*flow-uncovered-line(\s+[^*]*)?\*\/)/;
const flowNextUncoveredLineRegex = /(\/\/\s*flow-(next-uncovered|uncovered-next)-line|\/\*\s*flow-(next-uncovered|uncovered-next)-line(\s+[^*]*)?\*\/)/;

const findIgnoredLinesAndPositions = (path, text) => {
    const lines = text.split('\n');
    const ignored /*: {[key: number]: boolean} */ = {};
    const lineOffsets /*: {[key: number]: number} */ = {};
    const ignoreBlocks = [];
    const unmatchedBlocks = [];
    let ignoring = false;
    let next = false;
    let numLines = 0;
    let blockStart = 0;
    lineOffsets[0] = 0;

    lines.forEach((line, i) => {
        i = i + 1; // one-indexed
        lineOffsets[i] = lineOffsets[i - 1] + line.length + 1;
        if (line.match(/^\s*\/\* flow-uncovered-block \*\//)) {
            if (ignoring) {
                unmatchedBlocks.push([blockStart, i - 1]);
            }
            ignoring = true;
            blockStart = i;
            return;
        } else if (line.match(/^\s*\/\* end flow-uncovered-block \*\//)) {
            if (!ignoring) {
                throw new Error('unmatched end ignore pragma');
            }
            ignoring = false;
            ignoreBlocks.push([blockStart, i]);
            return;
        }
        if (next || flowUncoveredLineRegex.test(line)) {
            next = false;
            ignored[i] = true;
        } else if (ignoring) {
            ignored[i] = true;
        }
        next = flowNextUncoveredLineRegex.test(line);
        numLines = i;
    });
    return {
        unmatchedBlocks: unmatchedBlocks,
        ignoredLines: ignored,
        ignoredBlocks: ignoreBlocks,
        numLines: numLines,
        lineOffsets: lineOffsets,
    };
};

const collectWarnings = (fileName, lineStats, uncoveredLocs) => {
    const alreadyWarned /*: {[key: number]: boolean} */ = {};
    const errorExists /*: {[key: number]: boolean} */ = {};
    const warnings /*: Array<{
        path: string,
        start: {line: number, column: number},
        end: {line: number, column: number},
        annotationLevel: 'warning' | 'failure',
        message: string,
        offset: number,
    }> */ = [];
    const {
        ignoredLines,
        ignoredBlocks,
        numLines,
        lineOffsets,
        unmatchedBlocks,
    } = lineStats;
    const threshold = 0.8;

    unmatchedBlocks.forEach(([blockStart, blockEnd]) => {
        warnings.push({
            path: fileName,
            start: {line: blockStart, column: 0},
            end: {line: blockEnd, column: 0},
            annotationLevel: 'failure',
            message: `Unmatched /* flow-uncovered-block */`,
            offset: lineOffsets[blockStart],
        });
    });

    uncoveredLocs.forEach(({start, end}) => {
        if (alreadyWarned[start.line]) {
            return;
        }
        const isOneLine = start.line === end.line;
        errorExists[start.line] = true;
        if (isOneLine) {
            if (!ignoredLines[start.line]) {
                alreadyWarned[start.line] = true;
                warnings.push({
                    path: fileName,
                    start,
                    end,
                    annotationLevel: 'failure',
                    message: `The expression from ${start.line}:${
                        start.column
                    }-${
                        end.column
                        // Note that the `${''}` trick is so that it won't trip the regex that's looking for these comments
                    } is not covered by flow! If it's unavoidable, put '// flow-${''}uncovered-line' at the end of the line`,
                    offset: start.offset,
                });
            }
        } else {
            let ignored = true;
            for (let i = start.line; i <= end.line; i++) {
                if (!ignoredLines[i]) {
                    ignored = false;
                }
                errorExists[i] = true;
            }
            if (!ignored) {
                alreadyWarned[start.line] = true;
                warnings.push({
                    path: fileName,
                    start,
                    end,
                    annotationLevel: 'failure',
                    message: `The expression from ${start.line}:${
                        start.column
                    }-${end.line}:${
                        end.column
                    } is not covered by flow! If it's unavoidable, surround the expression in '/* flow-uncovered-block */' and '/* end flow-uncovered-block */'`,
                    offset: start.offset,
                });
            }
        }
    });
    let passable = 0;
    let currentBlock /*: ?[number, number] */ = ignoredBlocks.shift();
    for (let line = 1; line <= numLines; line++) {
        if (ignoredLines[line] && !errorExists[line]) {
            if (
                currentBlock &&
                currentBlock[0] <= line &&
                line <= currentBlock[1]
            ) {
                passable += 1;
            } else {
                const offset = lineOffsets[line] - 1;
                warnings.push({
                    path: fileName,
                    start: {line, column: 0},
                    end: {line, column: 0},
                    annotationLevel: 'failure',
                    message: `The expression in line ${line} is covered by flow! You should remove any '// flow-${''}uncovered-line' or '/* flow-uncovered-block */' comments applying to this line.`,
                    offset: offset,
                });
            }
        }
        if (currentBlock && line === currentBlock[1]) {
            const blockLength = currentBlock[1] - currentBlock[0];
            const offset = lineOffsets[currentBlock[0]] - 1;
            if (blockLength > 0 && passable / blockLength > threshold) {
                warnings.push({
                    path: fileName,
                    start: {line: currentBlock[0], column: 0},
                    end: {line: currentBlock[1], column: 0},
                    annotationLevel: 'failure',
                    message: `More than ${Math.floor(
                        threshold * 100,
                    )}% of lines in the 'flow-uncovered-block' from lines ${
                        currentBlock[0]
                    }-${
                        currentBlock[1]
                    } are covered by flow! You should remove this comment from the entire block and instead cover individual lines using '// flow-${''}uncovered-line'.`,
                    offset: offset,
                });
            }
            passable = 0;
            currentBlock = ignoredBlocks.shift();
        }
    }

    return warnings;
};

/*::
type CoverageInfo = {|
        expressions: {|
            uncovered_count: number,
            covered_count: number,
            uncovered_locs: $ReadOnlyArray<{|
                start: {line: number, column: number, offset: number},
                end: {line: number, column: number, offset: number},
            |}>,
        |},
    |}
*/

const getCoverage = (flowBin, filePath) => {
    const stdout = execSync(
        path.resolve(flowBin) + ` coverage --json ${filePath}`,
    ).toString('utf8');
    const data /*: CoverageInfo */ = JSON.parse(stdout); // flow-uncovered-line

    return data;
};

const isUncoveredFile = sourceText =>
    sourceText.split('\n').includes('/* flow-uncovered-file */');

const checkFile = (flowBin /*: string */, filePath /*: string */) => {
    const sourceText = fs.readFileSync(filePath).toString('utf8');

    if (isUncoveredFile(sourceText)) {
        // Skipping this one
        return [];
    }

    // not flow checked
    if (!sourceText.includes('@flow')) {
        return [];
    }

    const data = getCoverage(flowBin, filePath);
    if (!data.expressions.uncovered_count) {
        // All clear!
        return [];
    }

    const ignoredLinesAndPositions = findIgnoredLinesAndPositions(
        filePath,
        sourceText,
    );
    return collectWarnings(
        filePath,
        ignoredLinesAndPositions,
        data.expressions.uncovered_locs,
    );
};

module.exports = checkFile;
