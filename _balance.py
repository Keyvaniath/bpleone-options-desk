"""Careful JS brace/paren/bracket balance check with a proper char-by-char
tokenizer that tracks string/template/regex/comment state.
"""
import sys, os

def balance(src):
    i = 0
    n = len(src)
    stack = []
    line = 1
    col = 0
    while i < n:
        c = src[i]
        nxt = src[i+1] if i+1 < n else ''
        if c == '\n':
            line += 1; col = 0; i += 1; continue
        # comments
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n': i += 1
            continue
        if c == '/' and nxt == '*':
            i += 2
            while i < n-1 and not (src[i] == '*' and src[i+1] == '/'):
                if src[i] == '\n': line += 1
                i += 1
            i += 2; continue
        # strings
        if c in '"\'':
            quote = c; i += 1
            while i < n and src[i] != quote:
                if src[i] == '\\': i += 2; continue
                if src[i] == '\n': line += 1
                i += 1
            i += 1; continue
        # template literal
        if c == '`':
            i += 1
            while i < n and src[i] != '`':
                if src[i] == '\\': i += 2; continue
                if src[i] == '$' and i+1 < n and src[i+1] == '{':
                    # enter interpolation; recursively count
                    i += 2; depth = 1
                    while i < n and depth > 0:
                        if src[i] == '\\': i += 2; continue
                        if src[i] == '{': depth += 1
                        elif src[i] == '}': depth -= 1
                        elif src[i] in '"\'':
                            q = src[i]; i += 1
                            while i < n and src[i] != q:
                                if src[i] == '\\': i += 2; continue
                                i += 1
                        elif src[i] == '`':
                            # nested template — recurse simply
                            i += 1
                            while i < n and src[i] != '`':
                                if src[i] == '\\': i += 2; continue
                                i += 1
                        i += 1
                    continue
                if src[i] == '\n': line += 1
                i += 1
            i += 1; continue
        # regex literal: only if prev non-ws token is operator-ish
        if c == '/':
            # look back for a token signaling regex context
            j = i - 1
            while j >= 0 and src[j] in ' \t\n': j -= 1
            prev = src[j] if j >= 0 else ''
            if prev in '=({[,;:!&|?+-*~^<>%' or prev == '\n' or prev == '':
                # regex literal
                i += 1
                while i < n and src[i] != '/':
                    if src[i] == '\\': i += 2; continue
                    if src[i] == '[':
                        i += 1
                        while i < n and src[i] != ']':
                            if src[i] == '\\': i += 2; continue
                            i += 1
                    if i < n and src[i] != '/': i += 1
                # skip flags
                i += 1
                while i < n and src[i] in 'gimsuy': i += 1
                continue
            # else: division operator
            i += 1; continue
        if c in '{[(':
            stack.append((c, line))
        elif c in '}])':
            pairs = { '}':'{', ']':'[', ')':'(' }
            if not stack or stack[-1][0] != pairs[c]:
                return False, f'unexpected {c!r} at line {line}'
            stack.pop()
        i += 1
    if stack:
        return False, f'unclosed {stack[-1][0]!r} from line {stack[-1][1]}'
    return True, 'balanced'

if __name__ == '__main__':
    targets = sys.argv[1:] or [os.path.join('js', f) for f in sorted(os.listdir('js')) if f.endswith('.js')]
    all_ok = True
    for path in targets:
        with open(path, 'r', encoding='utf-8') as fh:
            src = fh.read()
        ok, msg = balance(src)
        if ok:
            print(f'  OK    {path}')
        else:
            print(f'  FAIL  {path}: {msg}')
            all_ok = False
    sys.exit(0 if all_ok else 1)
