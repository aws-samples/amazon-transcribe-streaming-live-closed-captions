#/bin/bash
# 2023-02-02 - test version
# Test using TSDUCK to create two outputs streams, delaying one by a defined amount of time
#
unset input
#unset inputb
unset output
unset format
unset delay
while getopts i:b:o:f:d: flag
do
    case "${flag}" in
        i) input=${OPTARG};;
#        b) inputb=${OPTARG};;
        o) output=${OPTARG};;
        f) format=${OPTARG};;
        d) delay=${OPTARG};;
    esac
done

if [ -z "$input" ]
then
   echo "Please provide an input, for example ./start.sh -i video.mp4"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -b rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
#if [ -z "$inputb" ]
#then
#   echo "Please provide a secondary input, for example ./start.sh -i video.mp4"
#   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -b rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
#   exit
#fi
if [ -z "$output" ]
then
   echo "Please provide an output, for example ./start.sh -o rtmps://urlhere/live/1234"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -b rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ -z "$format" ]
then
   echo "Please provide an output format, for example ./start.sh -f flv"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -b rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ -z "$delay" ]
then
   echo "Please provide an output video delay in milliseconds, for example, for 1.5 second video delay: ./start.sh -d 1500"
   echo "Example: ./start.sh -i rtmps://input-url/live/1234 -b rtmps://input-url/live/1234 -o rtmps://output-url/live/1234 -f flv -d 1.5"
   exit
fi
if [ ! -p transcript_fifo ]
then
   mkfifo transcript_fifo
fi

# Using ports 7000, 7001, 7002 for stream replication
# Convert input to a transport stream (TS)
ffmpeg -i $input -c:v copy -c:a copy -f mpegts udp://127.0.0.1:7000

# Use tsduck command line (tsp) 
tsp -i ip udp://127.0.0.1:7000 -P fork 'tsp -P regulate -O ip 127.0.0.1:7001' -P timeshift --directory /tmp/ --time $delay -P regulate -O ip 127.0.0.1:7002

nohup ffmpeg -loglevel quiet -re -thread_queue_size 1024 -sn -i udp://127.0.0.1:7002 -c:v copy -acodec aac -ab 160k -ar 44100 -f flv - | flv+srt - transcript_fifo - | nohup ffmpeg -loglevel quiet -y -i - -c:v copy -c:a copy -metadata:s:s:0 language=eng -f $format $output &
nohup ffmpeg -loglevel quiet -re -i udp://127.0.0.1:7001 -vn -ac 1 -c:a pcm_s16le -ar 16000 -f wav - | node index.js --fifo=transcript_fifo --stdin=true &
