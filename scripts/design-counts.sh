#!/usr/bin/env bash
# Kestrel design debt counts: values that bypass the tokens in public/ds/tokens.css.
# Run from the repo root: bash scripts/design-counts.sh
cd "$(dirname "$0")/../public" || exit 1
F=$(ls ds/*.css kestrel.css lab/lab.css index.html *.js lab/*.js)
echo "style=\" attributes:        $(cat index.html *.js lab/*.js | grep -o 'style="' | wc -l | tr -d ' ')"
echo "6-digit hex:                $(cat $F | grep -oE '#[0-9a-fA-F]{6}\b' | wc -l | tr -d ' ')"
echo "px radius literals:         $(cat $F | grep -oE 'border-radius:\s*[0-9][^;\"}]*' | grep -vE 'radius:\s*(0|50%|999px)\s*$' | wc -l | tr -d ' ')"
echo "font-size literals:         $(cat $F | grep -oE 'font-size:\s*[0-9.]+(px|rem)' | wc -l | tr -d ' ')"
echo "font: shorthand px sizes:   $(cat $F | grep -oE 'font:\s*[0-9]{3}\s+[0-9.]+px' | wc -l | tr -d ' ')"
echo "!important:                 $(cat ds/*.css kestrel.css lab/lab.css | grep -o '!important' | wc -l | tr -d ' ')"
