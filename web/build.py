#!/usr/bin/env python3
"""Recombine src/ parts into dist/encore.html (single-file Encore build)."""
import pathlib, sys
root = pathlib.Path(__file__).parent
order = ['head.html', 'styles.css', 'body.html', 'app.js', 'tail.html']
out = ''.join((root / 'src' / n).read_text(encoding='utf-8') for n in order)
dest = root / 'dist' / (sys.argv[1] if len(sys.argv) > 1 else 'encore.html')
dest.parent.mkdir(parents=True, exist_ok=True)
dest.write_text(out, encoding='utf-8')
print(dest, len(out.encode('utf-8')), 'bytes')
