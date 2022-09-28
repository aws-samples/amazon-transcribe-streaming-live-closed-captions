/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

const getTimestamp = (captionSeconds) => {
  const seconds = (Math.floor(captionSeconds) % 60).toString().padStart(2, '0');
  const minutes = (Math.floor(seconds / 60) % 60).toString().padStart(2, '0');
  const hours = Math.floor(minutes / 60).toString().padStart(2, '0');
  const millisecond = (Math.floor(captionSeconds * 1000) % 1000).toString().padStart(3, '0');

  return `${hours}:${minutes}:${seconds}.${millisecond}`;
};

module.exports.getTimestamp = getTimestamp;

module.exports.splitIntoChunks = (transcript) => {
  const transcriptArray = [];
  let lastLine = transcript;

  while (lastLine.length > 47) {
    const spaceIndex = lastLine.lastIndexOf(' ', 47);
    transcriptArray.push(lastLine.substring(0, spaceIndex));
    lastLine = lastLine.substring(spaceIndex + 1, lastLine.length);
  }
  transcriptArray.push(lastLine);

  return transcriptArray;
};
