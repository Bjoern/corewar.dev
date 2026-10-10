#!/bin/bash
for f in "$@"
do
  if ! { echo -e "f\nn\n./pmars -b -8 -F 7293 -r 500 -s 8000 -p 8000 -c 80000 -l 100\ny\n$f.res\n\n$f";
  ls ./*.red -1; echo; } | ./mts; then
    rm _recover.mts
    exit
  fi
  mv "$f" "$f".rc
done

