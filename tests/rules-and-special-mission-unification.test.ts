import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { 
  BUSHIDO_SYSTEM_RULES, 
  BUSHIDO_SPECIAL_MISSION_GUIDE, 
  BUSHIDO_HABITS_PHILOSOPHY 
} from '../src/data/moreTabData';

describe('Discipline Rules and Special Mission Unification', () => {
  it('1. BUSHIDO_SYSTEM_RULES defines all 4 discipline laws with correct tokens', () => {
    assert.strictEqual(BUSHIDO_SYSTEM_RULES.length, 4);

    const standardDay = BUSHIDO_SYSTEM_RULES.find(r => r.id === 'standard-day');
    assert.ok(standardDay, 'standard-day rule should exist');
    assert.strictEqual(standardDay?.badge, '۸ از ۱۰');
    assert.strictEqual(standardDay?.colorToken, 'emerald');

    const masteryDay = BUSHIDO_SYSTEM_RULES.find(r => r.id === 'mastery-day');
    assert.ok(masteryDay, 'mastery-day rule should exist');
    assert.strictEqual(masteryDay?.badge, '۱۰ از ۱۰');
    assert.strictEqual(masteryDay?.colorToken, 'amber');

    const debt = BUSHIDO_SYSTEM_RULES.find(r => r.id === 'debt-autopsy');
    assert.ok(debt, 'debt-autopsy rule should exist');
    assert.strictEqual(debt?.badge, 'کسر امتیاز');
    assert.strictEqual(debt?.colorToken, 'debt');

    const freeze = BUSHIDO_SYSTEM_RULES.find(r => r.id === 'emergency-freeze');
    assert.ok(freeze, 'emergency-freeze rule should exist');
    assert.strictEqual(freeze?.badge, 'حفظ زنجیره');
    assert.strictEqual(freeze?.colorToken, 'blue');
  });

  it('2. BUSHIDO_SPECIAL_MISSION_GUIDE defines the 90-day goal alignment and criteria', () => {
    assert.ok(BUSHIDO_SPECIAL_MISSION_GUIDE.title.includes('ماموریت ویژه'));
    assert.ok(BUSHIDO_SPECIAL_MISSION_GUIDE.howItWorks.includes('۹۰ روزه'));
    assert.ok(BUSHIDO_SPECIAL_MISSION_GUIDE.criteria.length > 20);
    assert.ok(BUSHIDO_SPECIAL_MISSION_GUIDE.tacticalTip.length > 20);
  });

  it('3. ProfileSettingsView contains both the 4 discipline rules and the special mission card', () => {
    const filePath = path.resolve(process.cwd(), 'src/components/ProfileSettingsView.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('guide-special-mission-card'), 'ProfileSettingsView should have guide-special-mission-card');
    assert.ok(content.includes('guide-discipline-laws-card'), 'ProfileSettingsView should have guide-discipline-laws-card');
    assert.ok(content.includes('BUSHIDO_SYSTEM_RULES'), 'ProfileSettingsView should map BUSHIDO_SYSTEM_RULES');
    assert.ok(content.includes('BUSHIDO_SPECIAL_MISSION_GUIDE'), 'ProfileSettingsView should use BUSHIDO_SPECIAL_MISSION_GUIDE');
  });

  it('4. DisciplineRulesModal uses unified BUSHIDO_SYSTEM_RULES and BUSHIDO_SPECIAL_MISSION_GUIDE', () => {
    const filePath = path.resolve(process.cwd(), 'src/components/DisciplineRulesModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('BUSHIDO_SYSTEM_RULES'), 'DisciplineRulesModal should map BUSHIDO_SYSTEM_RULES');
    assert.ok(content.includes('BUSHIDO_SPECIAL_MISSION_GUIDE'), 'DisciplineRulesModal should use BUSHIDO_SPECIAL_MISSION_GUIDE');
  });

  it('5. BattlefieldView links daily special mission card with 90-day cycle targetTheme', () => {
    const filePath = path.resolve(process.cwd(), 'src/components/BattlefieldView.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('battlefield-special-mission-card'), 'BattlefieldView should have battlefield-special-mission-card');
    assert.ok(content.includes('currentCycle?.targetTheme'), 'BattlefieldView should display currentCycle targetTheme when present');
  });

  it('6. CreateCycleModal describes targetTheme as the 90-day goal basis for the daily special mission', () => {
    const filePath = path.resolve(process.cwd(), 'src/components/CreateCycleModal.tsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    assert.ok(content.includes('هدف و میثاق ۹۰ روزه چرخه (ماموریت ویژه روزانه)'), 'CreateCycleModal should explicitly label the 90-day goal for special mission');
    assert.ok(content.includes('ماموریت ویژه روز'), 'CreateCycleModal helper text should explain the daily special mission connection');
  });
});
