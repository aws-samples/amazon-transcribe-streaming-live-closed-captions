#/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
unset input
unset output
unset format
unset delay
while getopts i:o:f:d: flag
do
    case "${flag}" in
        i) input=${OPTARG};;
        o) output=${OPTARG};;
        f) format=${OPTARG};;
        d) delay=${OPTARG};;
    esac
done

if [ -z "$input" ]
then
   echo "Please provide an input, for example ./start.sh -i video.mp4"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ -z "$output" ]
then
   echo "Please provide an output, for example ./start.sh -o rtmps://urlhere/live/1234"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ -z "$format" ]
then
   echo "Please provide an output format, for example ./start.sh -f flv"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ -z "$delay" ]
then
   echo "Please provide an output video delay in seconds, for example, for 1.5 second video delay: ./start.sh -d 1.5"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
ffmpeg -itsoffset $delay -loglevel quiet -re -i $input -c:v libx264 -profile:v main -preset veryfast -g 120 -x264opts "nal-hrd=cbr:no-scenecut" -acodec aac -ab 160k -ar 44100 -f flv - | flv+srt - transcript_fifo - | ffmpeg -loglevel quiet -y -i - -c:v copy -c:a aac -ar 44100 -ac 1 -metadata:s:s:0 language=eng -f $format $output &
ffmpeg -loglevel quiet -re -i $input -vn -ac 1 -c:a pcm_s16le -ar 16000 -f wav - | node index.js --fifo=transcript_fifo --stdin=true &