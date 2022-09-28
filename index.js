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

// ffmpeg -re -i ../rawvideo.mp4 -codec:v libx264  -vsync 1 -c:a aac -f segment -segment_time 2  \
// -reset_timestamps 1 -force_key_frames "expr: gte(t, n_forced * 2)" "mp4/output_%03d.mp4" \
// -ac 1 -c:a pcm_s16le -ar 16000 -f segment -segment_time 2 "wav/output_%03d.wav"

/* eslint-disable no-console */

/* require for packages */
const chokidar = require('chokidar');
const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming');
const stream = require('stream');
const fs = require('fs');
const path = require('path');
const timerPromises = require('timers/promises');
const utf8 = require('utf8');
const { exec } = require('child_process');
const m3u8 = require('m3u8');

/* requires for local files */
const srt = require('./srt');
const argv = require('./argv');

/* Constants */
const REGION = 'us-west-2';
const isFifo = argv('fifo');
const relativeTime = (!isFifo); // if true, the timestamps will be zeroed every file
const fifoFileName = (isFifo && argv('fifo').length > 0 ? isFifo : 'fifo_srt');
const mediaStoreEndpoint = (argv('mediaStoreEndpoint') ? argv('mediaStoreEndpoint') : '');
const wavSubDir = 'wav';
const wavDirPath = path.join(__dirname, wavSubDir);
const srtDir = 'srt';
const srtDirPath = path.join(__dirname, srtDir);
const mp4Dir = 'mp4';
const mp4DirPath = path.join(__dirname, mp4Dir);
const mergedMp4Dir = 'mergedmp4';
const mergedMp4DirPath = path.join(__dirname, mergedMp4Dir);
const m3u8FilePath = path.join(mergedMp4Dir, 'output.m3u8');
const filesToProcess = [];
const passthroughStream = new stream.PassThrough({ highWaterMark: 128 });
const sampleRate = 16000;
const segmentDuration = 2.0; // 2 second segments
// const byteSize = 2; // 16 bit
const chunkDuration = 0.250; // 250 ms chunks - so it should send 8 chunks per file
const chunkDurationMs = 1000 * chunkDuration;
const chunkSize = (sampleRate * 2) * chunkDuration;
const backPressure = 1.5; // this means it will run 1.2x faster
const forwardPressure = 1; // wait 1 second for transcribe before generating SRT
const sleepForDuration = true; // sleep for entire file duration before generating SRT?

/* Variables */
const transcripts = [];
let currentSegment = -1;
let currentTranscriptSegment;
let currentTranscriptCuts = 0;

let totalCaptions = 0;

const m3u = m3u8.M3U.create();

/* Write SRT from Transcrpt _only_ every chunk */

const findTranscriptsBetween = (startTime, endTime) => {
  const transcriptsInPeriod = [];
  transcripts.forEach((transcript) => {
    console.log(transcript.StartTime, transcript.EndTime);

    if (transcript.StartTime >= startTime && transcript.StartTime <= endTime) {
      // this transcript starts during this period
      transcriptsInPeriod.push(transcript);
    } else if (transcript.EndTime >= startTime && transcript.EndTime <= endTime) {
      // this transcript ends during this period
      transcriptsInPeriod.push(transcript);
    }
  });

  if (currentTranscriptSegment) {
    if (currentTranscriptSegment.StartTime >= startTime
      && currentTranscriptSegment.StartTime <= endTime) {
      console.log('transcript starts during this period');
      transcriptsInPeriod.push(currentTranscriptSegment);
    } else if (currentTranscriptSegment.EndTime >= startTime
      && currentTranscriptSegment.EndTime <= endTime) {
      console.log('transcript ends during this period');
      transcriptsInPeriod.push(currentTranscriptSegment);
    } else if (currentTranscriptSegment.StartTime <= startTime
      && currentTranscriptSegment.EndTime >= endTime) {
      console.log('transcript starts and ends before and after this period');
      transcriptsInPeriod.push(currentTranscriptSegment);
    } else {
      console.log('current transcript does not fall in this period');
    }
  }

  return transcriptsInPeriod;
};

const addToM3U8 = async function addToM3U8(mp4File) {
  m3u.addPlaylistItem({
    duration: 2,
    uri: mp4File,
  });
  const mp4FilePath = path.join(mergedMp4Dir, mp4File);
  const output = m3u.toString();
  console.log(`writing m3u8 ${m3u8FilePath}:`);
  console.log(output);
  fs.writeFile(m3u8FilePath, output, (err) => {
    if (err) console.log('error writing m3u8');
    else console.log('m3u8 done writing');
  });

  // copy both to mediastore
  const copyMp4 = `aws mediastore-data put-object --endpoint ${mediaStoreEndpoint} --body ${mp4FilePath} --path ${mp4FilePath} --content-type video/mp4 --region ${REGION}`;
  exec(copyMp4, (error, stdout, stderr) => {
    if (error) {
      console.error(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout:\n${stdout}`);
  });

  const copym3u8 = `aws mediastore-data put-object --endpoint ${mediaStoreEndpoint} --body ${m3u8FilePath} --path ${m3u8FilePath} --content-type application/x-mpegURL --region ${REGION}`;
  exec(copym3u8, (error, stdout, stderr) => {
    if (error) {
      console.error(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout:\n${stdout}`);
  });
};

const mergeMP4WithSRT = async function mergedMP4WithSRT(filePath) {
  await timerPromises.setTimeout(2000);

  // Look for m4p with the same name
  const srtFilePath = path.join(srtDir, filePath.replace(/(\.\w+)+$/, '').concat('.srt'));
  const mp4FilePath = path.join(mp4Dir, filePath.replace(/(\.\w+)+$/, '').concat('.mp4'));
  const mp4MergedFile = filePath.replace(/(\.\w+)+$/, '').concat('_cc.mp4');
  const mergedMp4FilePath = path.join(mergedMp4Dir, mp4MergedFile);

  // We'll assume mp4 is already in here
  const ffmpegCmd = `ffmpeg -hide_banner -loglevel error -i ${mp4FilePath} -i ${srtFilePath} -map 0:v -map 0:a -c copy -map 1 -c:s:0 mov_text -metadata:s:s:0 language=eng ${mergedMp4FilePath}`;
  console.log(ffmpegCmd);
  exec(ffmpegCmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`error: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(`stdout:\n${stdout}`);
  });

  await addToM3U8(mp4MergedFile);
};

/// this will generate an SRT string for a particular transcript object
let fifoWs;
if (isFifo) {
  fifoWs = fs.openSync(fifoFileName, 'w');
  console.log(`opening write stream to ${fifoFileName}`);
}

const generateSRTFifo = (transcript) => {
  // console.log('generating srt');
  totalCaptions += 1;

  let srtOutput = '';
  const captionStart = 0;
  let captionEnd = transcript.EndTime - transcript.StartTime;

  if (transcript.lastDuration) {
    captionEnd -= transcript.lastDuration;
  }

  /* output the caption number */
  if (isFifo) srtOutput += '0\n';
  else srtOutput += `${totalCaptions.toString()}\n`;

  srtOutput += `${srt.getTimestamp(captionStart)} --> ${srt.getTimestamp(captionEnd)}\n`;
  /* output the caption, one or two lines */
  srtOutput += `${transcript.Transcript.Line1.padEnd(31, ' ')}\n`;
  srtOutput += `${transcript.Transcript.Line2.padEnd(31, ' ')}\n`;
  srtOutput += `${transcript.Transcript.Line3.padEnd(31, ' ')}\n`;
  srtOutput += `${transcript.Transcript.Line4.padEnd(31, ' ')}\n`;
  srtOutput += '\0';

  console.log(srtOutput);
  fs.writeSync(fifoWs, utf8.encode(srtOutput));
};

const generateSRTForSegment = async (filePath, segmentNumber) => {
  await timerPromises.setTimeout(forwardPressure * 1000);
  const srtFilePath = path.join(srtDir, filePath.replace(/(\.\w+)+$/, '').concat('.srt'));
  const startTime = segmentNumber * segmentDuration;
  const endTime = startTime + segmentDuration;
  console.log('Generating SRT - ', srtFilePath, 'for time', startTime.toString(), '-', endTime.toString());

  const transcriptsForTime = findTranscriptsBetween(startTime, endTime);
  let srtOutput = '';
  let captionCount = 0;
  transcriptsForTime.forEach((transcript) => {
    captionCount += 1;
    totalCaptions += 1;

    let captionStart = (relativeTime ? transcript.StartTime - startTime : transcript.StartTime);
    let captionEnd = (relativeTime ? transcript.EndTime - startTime : transcript.EndTime);

    if (captionStart < 0) captionStart = 0;
    if (relativeTime && (captionEnd > segmentDuration || transcript.IsPartial === true)) {
      captionEnd = segmentDuration;
    }

    /* output the caption number */
    if (relativeTime) srtOutput += `${captionCount.toString()}\n`;
    else srtOutput += `${totalCaptions.toString()}\n`;

    /* output the timestamp */
    srtOutput += `${srt.getTimestamp(captionStart)} --> ${srt.getTimestamp(captionEnd)}\n`;

    /* output the caption, one or two lines */
    srtOutput += `${transcript.Transcript.Line1}\n`;
    srtOutput += `${transcript.Transcript.Line2}\n`;
    srtOutput += '\n';
  });

  if (srtOutput.length === 0) {
    srtOutput += '1\n';
    srtOutput += '00:00:00,000 --> 00:00:02,000';
    srtOutput += '\n\n';
  }

  fs.writeFileSync(srtFilePath, utf8.encode(srtOutput));
  await mergeMP4WithSRT(filePath);
};

/* Process files */

const processFiles = async () => {
  console.log('FileDropped');

  const filePath = filesToProcess.shift();
  if (filePath) {
    console.log(`Processing ${filePath}`);

    currentSegment += 1;
    const thisSegment = currentSegment;
    const fullPath = path.join(wavSubDir, filePath);
    const fileData = fs.readFileSync(fullPath);
    const numChunks = fileData.length / chunkSize;
    console.log(`length for ${fullPath}: ${fileData.length}`);
    for (let i = 0; i < numChunks; i += 1) {
      passthroughStream.write(fileData.subarray(i * chunkSize, i * chunkSize + chunkSize));
      // eslint-disable-next-line no-await-in-loop
      if (!isFifo) await timerPromises.setTimeout(chunkDurationMs / backPressure);
    }
    if (!isFifo) {
      // we only want to generate one of these every 2 seconds
      // if we're not writing to fifo immediately
      // sleep the number of seconds we skipped from backpressure
      const sleepAmt = (chunkDurationMs * numChunks) - (chunkDurationMs / backPressure) * numChunks;
      console.log('sleep', sleepAmt);
      if (sleepForDuration) await timerPromises.setTimeout(sleepAmt);
      await generateSRTForSegment(filePath, thisSegment);
    }
  }
};

/* Configure file watcher */

if (argv('stdin')) {
  console.log('input is standard in');
  // we should configure stdin reading
  process.stdin
    .on('data', (data) => {
      // this is audio data
      passthroughStream.write(data);
    })
    .on('end', () => {
      // do something when the stream stops
    });
} else {
  console.log('listening to wav folder');
  // One-liner for current directory
  const fileWatcher = chokidar.watch('.', {
    persistent: true,
    cwd: wavSubDir,
    awaitWriteFinish: {
      stabilityThreshold: 2500,
      pollInterval: 500,
    },
    ignoreInitial: true,
  });

  fileWatcher.on('add', async (filePath) => {
    // queue file to processing array
    filesToProcess.push(filePath);
    processFiles(); // this should only happen every X seconds.
  });
}

/* Configure Transcribe */
const audioStream = async function* audioStream() {
  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const payloadChunk of passthroughStream) {
      yield { AudioEvent: { AudioChunk: payloadChunk } };
    }
  } catch (error) {
    console.log('Error reading passthrough stream or yielding audio chunk.');
  }
};

const startTranscribe = async function startTranscribe() {
  console.log('starting transcribe');
  const tsClient = new TranscribeStreamingClient({ region: REGION });
  const tsParams = {
    LanguageCode: 'en-US',
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: sampleRate,
    AudioStream: audioStream(),
  };

  const tsCmd = new StartStreamTranscriptionCommand(tsParams);
  const tsResponse = await tsClient.send(tsCmd);
  const tsStream = stream.Readable.from(tsResponse.TranscriptResultStream);

  try {
    // eslint-disable-next-line no-restricted-syntax
    for await (const chunk of tsStream) {
      // console.log(JSON.stringify(chunk));
      if (chunk.TranscriptEvent.Transcript.Results.length > 0) {
        const transcript = {
          StartTime: chunk.TranscriptEvent.Transcript.Results[0].StartTime,
          EndTime: chunk.TranscriptEvent.Transcript.Results[0].EndTime,
          IsPartial: chunk.TranscriptEvent.Transcript.Results[0].IsPartial,
        };

        // split transcript into two lines
        const text = chunk.TranscriptEvent.Transcript.Results[0].Alternatives[0].Transcript;
        const lines = srt.splitIntoChunks(text);

        if (lines.length > 2) {
          // we got a situation where we gotta save and break the
          // transcript into two segments
          console.log('TODO - extra long line we gotta deal with');
          currentTranscriptCuts += Math.floor(lines.length / 2);
        }

        transcript.Transcript = {
          Line1: lines[0],
          Line2: (lines.length > 1 ? lines[1] : ''),
          Line3: (lines.length > 2 ? lines[2] : ''),
          Line4: (lines.length > 3 ? lines[3] : ''),
        };

        if (transcript.IsPartial === true) {
          currentTranscriptSegment = transcript;
        } else {
          currentTranscriptSegment = undefined;
          transcripts.push(transcript);
        }

        if (isFifo) {
          generateSRTFifo(transcript);
        }
      }
    }
  } catch (error) {
    // console.log(error);
    console.log('error writing transcription segment', JSON.stringify(error), error);
  } finally {
    // close streams
    console.log('closing stream');
  }
};

const createDirs = function createDirs(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }
};

/* Start Application */

// create srt directory if not exists
createDirs(wavDirPath);
createDirs(srtDirPath);
createDirs(mp4DirPath);
createDirs(mergedMp4DirPath);

// start transcribing
startTranscribe();
