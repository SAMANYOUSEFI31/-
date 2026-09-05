import re

with open('tests/phase-3b3-replay-contract-closure.test.ts', 'r') as f:
    lines = f.readlines()

def fix_line(i, line):
    if "typeof init !== 'undefined'" not in line:
        return line
    if line.endswith("}; }; };\n"):
        return line.replace("}; }; };\n", "}; } };\n")
    if line.endswith("}; }; };);\n"):
        return line.replace("}; }; };);\n", "}; } });\n")
    return line

for i in range(len(lines)):
    lines[i] = fix_line(i, lines[i])

with open('tests/phase-3b3-replay-contract-closure.test.ts', 'w') as f:
    f.writelines(lines)
