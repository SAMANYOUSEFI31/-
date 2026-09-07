const fs = require('fs');
const content = fs.readFileSync('src/utils/directMutationUtils.ts', 'utf8');

const updated = content.replace(
  /type: 'UPDATE_CYCLE',(\s+)expectedRevision: serverCycle.revision,/g,
  `type: 'UPDATE_CYCLE' as 'UPDATE_CYCLE',$1expectedRevision: serverCycle.revision,`
);

fs.writeFileSync('src/utils/directMutationUtils.ts', updated);
