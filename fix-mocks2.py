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
            
        def replacer(match):
            return "json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }"
            
        new_content = re.sub(r"json:\s*async\s*\(\)\s*=>\s*\(\{\s*success:\s*true,\s*log:.*?\}\s*\)\s*\}\)", replacer, content, flags=re.DOTALL)
        
        # Replace `async () => {` with `async (url?: any, init?: any) => {` for mockFetch definitions
        new_content = re.sub(r"const mockFetch(.*?)=\s*async\s*\(\)\s*=>\s*\{", r"const mockFetch\1= async (url?: any, init?: any) => {", new_content)
        new_content = re.sub(r"const countingFetch\s*=\s*async\s*\(\)\s*=>\s*\{", r"const countingFetch = async (url?: any, init?: any) => {", new_content)
        new_content = re.sub(r"const mockFetchA\s*=\s*async\s*\(\)\s*=>\s*\{", r"const mockFetchA = async (url?: any, init?: any) => {", new_content)
        new_content = re.sub(r"const mockFetchB\s*=\s*async\s*\(\)\s*=>\s*\{", r"const mockFetchB = async (url?: any, init?: any) => {", new_content)
        new_content = re.sub(r"const mock401Fetch\s*=\s*async\s*\(\)\s*=>\s*\{", r"const mock401Fetch = async (url?: any, init?: any) => {", new_content)
        new_content = re.sub(r"const mockNetworkFailureFetch\s*=\s*async\s*\(\)\s*=>\s*\{", r"const mockNetworkFailureFetch = async (url?: any, init?: any) => {", new_content)
        
        # also replace `fetchFn: (async () => ({ ok: true, status: 200, json: ... })) as any`
        new_content = re.sub(r"fetchFn:\s*\(async\s*\(\)\s*=>\s*\(\{\s*ok:\s*true.*?\}\)\)\s*as\s*any", 
                             r"fetchFn: (async (url?: any, init?: any) => ({ ok: true, status: 200, json: async () => { const b = init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } })) as any", new_content, flags=re.DOTALL)
        
        # also for the resolveFetch
        new_content = re.sub(r"resolveFetch\(\{\s*ok:\s*true,\s*status:\s*200,\s*json:.*?\}\)", 
                             r"resolveFetch({ ok: true, status: 200, json: async () => ({ success: true, log: { date: '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }) })", new_content, flags=re.DOTALL)
        
        
        if new_content != content:
            with open(path, 'w') as file:
                file.write(new_content)
            print(f"Updated {path}")
