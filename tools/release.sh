#!/bin/bash
set -euf -o pipefail

# Run from the root
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
cd $SCRIPT_DIR/..

VERSION=$(node -p "require('./package.json').version")
echo "Releasing v$VERSION"

if git tag -l "v$VERSION" | grep -q .; then
    echo "Tag v$VERSION already exists."
    exit 1
fi

if [[ -z "$(git status --untracked-files=no --porcelain)" ]]; then
    echo "Clean"
    # Create a branch from the root commit
    git checkout --orphan v$VERSION-dist
    # Remove all files
    git read-tree -u --reset $(git hash-object -t tree /dev/null)
    # Restore just what we want from main
    git checkout main -- README.md action.yml
    git add -f README.md action.yml dist/action.js
    git commit -m "Release v$VERSION"
    git tag v$VERSION HEAD
    git tag -f v1 HEAD
    git checkout main

    echo ""
    echo "Done. Next steps:"
    echo "  git push origin v$VERSION v1 --force"
    echo "  gh release create v$VERSION --generate-notes"
    echo "  npm publish"
    exit 0
else
    echo "Working directory not clean."
    exit 1  
fi
