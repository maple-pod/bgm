#!/usr/bin/env sh

set -e

cd dist

if git rev-parse --git-dir > /dev/null 2>&1; then
else
  git init
fi

git add -A
git commit -m 'deploy'

git push -f https://github.com/maple-pod/bgm.git master:gh-pages

cd -