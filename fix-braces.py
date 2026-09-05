import re

with open('tests/phase-3b3-replay-contract-closure.test.ts', 'r') as f:
    content = f.read()
    
# Replace the bad ending
bad_ending = "specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; };"
good_ending = "specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }"
content = content.replace(bad_ending, good_ending)

# Also fix the ones that have b.id || b.date
bad_ending2 = "specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; };"
good_ending2 = "specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }"
content = content.replace(bad_ending2, good_ending2)

# Also resolveFetch
bad_ending3 = "specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } });"
good_ending3 = "specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } })"
# wait resolveFetch already had: json: async () => { ... return ... ; } });
# the original was `json: async () => { ... }` so `} });` was correct if it was `resolveFetch({ ... json: async () => { ... } });`
# let's just make sure they parse by running tsc or eslint on it.

with open('tests/phase-3b3-replay-contract-closure.test.ts', 'w') as f:
    f.write(content)
