const fs = require('fs');
let css = fs.readFileSync('src/styles/tokens.css', 'utf8');
css = css.replace('.text-role-primary {\n  color: var(--color-text-primary) !important;\n}', '.text-role-primary {\n  color: var(--color-text-primary) !important;\n}\n\n.bg-role-primary {\n  background-color: var(--color-text-primary) !important;\n}\n\n.bg-role-secondary {\n  background-color: var(--color-text-secondary) !important;\n}');
fs.writeFileSync('src/styles/tokens.css', css);
