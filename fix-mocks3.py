import os

TEST_DIR = 'tests'

old_str = "json: async () => ({ success: true, log: { date: '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } })"

new_str = "json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }"

for root, _, files in os.walk(TEST_DIR):
    for f in files:
        if not f.endswith('.test.ts'):
            continue
        path = os.path.join(root, f)
        with open(path, 'r') as file:
            content = file.read()
            
        new_content = content.replace(old_str, new_str)
        
        if new_content != content:
            with open(path, 'w') as file:
                file.write(new_content)
            print(f"Updated {path}")
