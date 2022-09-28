### License:
Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
SPDX-License-Identifier: MIT-0

# amazon-transcribe-live-closed-captioning

This project will inject live closed captioning to an input video stream, and send the combined output to a destination.

### Installation

This project requires nodejs 16+ and cmake build tools.

1. Clone the repo and navigate into the project folder
2. `npm install` to install dependencies.
3. Compile and install libcaption from the libcaption folder per readme
4. Install ffmpeg

### Running

There is a bash script `start.sh` to start up all the components. The 4 parameters are:
1. `-i input_url`, input/source stream url
2. `-d destination_url`, the output/destination stream url
3. `-f format`, the output/destination format. If RTMP, then use flv
4. `-d delay`, the delay to add to the video to sync up the subtitles

`chmod +x start.sh` 
`./start.sh -i rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5`
