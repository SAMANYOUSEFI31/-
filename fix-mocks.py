import os
import re

TEST_DIR = 'tests'

for root, _, files in os.walk(TEST_DIR):
    for f in files:
        if not f.endswith('.test.ts'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r') as file:
            content = file.read()
            
        # We need to replace `json: async () => ({ success: true })` or `json: async () => ({})`
        # with `json: async () => ({ log: { date: '1403-12-01', cycleId: 'c1', revision: 1, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'c1', revision: 1, title: 't', startDate: 'd', endDate: 'd' }, success: true })`
        
        replacement = "json: async () => ({ success: true, log: { date: '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } })"
        
        new_content = re.sub(r"json:\s*async\s*\(\)\s*=>\s*\(\{\s*success:\s*true\s*\}\)", replacement, content)
        new_content = re.sub(r"json:\s*async\s*\(\)\s*=>\s*\(\{\s*\}\)", replacement, new_content)
        
        if new_content != content:
            with open(path, 'w') as file:
                file.write(new_content)
            print(f"Updated {path}")
