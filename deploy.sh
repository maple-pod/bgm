#!/usr/bin/env sh

set -e

pnpm run build

cd dist

git init
git add -A
git commit -m 'deploy'

git push -f https://github.com/maple-pod/bgm.git master:gh-pages

cd -