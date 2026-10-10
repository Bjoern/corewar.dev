#!/bin/bash
echo "        Name                    Author                    W   L   T   Score"
echo "---------------------------------------------------------------------------"
grep "^  1    " -h ./*.res |sort -nr -k1.71,1.80

