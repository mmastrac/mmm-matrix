#!/bin/bash
set -euf -o pipefail

# Run from the root
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR/..

# Disable the real GitHub output if we're running on GitHub
export GITHUB_OUTPUT=

diff -u test/dist/dist-test.out <(. test/dist/dist-test.in && node dist/action.js)
diff -u test/dist/dist-config.out <(. test/dist/dist-config.in && node dist/action.js)
diff -u test/dist/dist-default.out <(. test/dist/dist-default.in && node dist/action.js)
echo Tests passed.
