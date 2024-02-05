#!/bin/bash
set -euf -o pipefail

# Run from the root
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR/..

if [[ "$#" == "1" ]]; then
    export VERSION=$1
    echo "Releasing $VERSION"
else
    echo "No version provided."
    exit 1
fi

if [[ -z "$(git status --untracked-files=no --porcelain)" ]]; then
    echo "Clean"
    # Create a branch from the root commit
    git checkout --orphan $VERSION-dist
    # Remove all files
    git read-tree -u --reset $(git hash-object -t tree /dev/null)
    # Restore just what we want from main
    git checkout main -- README.md action.yml
    git add -f README.md action.yml dist/action.js
    git commit -m "Release $VERSION"
    git tag $VERSION HEAD
    git checkout main
    exit 0
else
    echo "Working directory not clean."
    exit 1  
fi
