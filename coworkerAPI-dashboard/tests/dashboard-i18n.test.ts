import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import test from 'node:test';
import { DASHBOARD_MESSAGES, DASHBOARD_I18N_SCRIPT, dashboardMessageKey } from '../src/dashboard-i18n.js';

test('dashboard catalog covers English and Vietnamese and all keyed UI references', () => {
  for (const [key, entry] of Object.entries(DASHBOARD_MESSAGES)) {
    assert.ok(entry.vi.trim(), key + ' missing Vietnamese');
    assert.ok(entry.en.trim(), key + ' missing English');
    assert.ok(!/\bCLI\b/.test(entry.vi + entry.en), key + ' limits general dashboard copy to CLI');
    const variables = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(variables(entry.vi), variables(entry.en), key + ' mismatched parameters');
  }
  for (const name of ['dashboard.ts','dashboard-tour.ts','dashboard-connections.ts','dashboard-design.ts']) {
    const source = readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
    for (const match of source.matchAll(/(?:t\(["']|data-i18n(?:-[a-z-]+)?=")((?:ui|tour|common)\.[a-z0-9_.-]+)/g))
      assert.ok(DASHBOARD_MESSAGES[match[1]], name + ' references missing key ' + match[1]);
  }
  assert.equal(dashboardMessageKey('Tổng quan'), 'ui.overview');
});

function localeContext(saved?: string, unavailable = false) {
  const values = new Map<string, string>(saved ? [['coworkerapi.locale', saved]] : []);
  const context = createContext({
    $: () => null,
    localStorage: {
      getItem: (key: string) => { if (unavailable) throw Error('blocked'); return values.get(key) ?? null; },
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
    document: { documentElement: { setAttribute() {} }, querySelectorAll: () => [] },
  });
  new Script(DASHBOARD_I18N_SCRIPT).runInContext(context);
  return context;
}

test('dashboard locale defaults to Vietnamese, restores English and ignores unsupported values', () => {
  for (const saved of [undefined, 'de', 'vi']) {
    assert.equal(new Script("t('ui.overview')").runInContext(localeContext(saved)), 'Tổng quan');
  }
  assert.equal(new Script("t('ui.overview')").runInContext(localeContext(undefined, true)), 'Tổng quan');
  const english = localeContext('en');
  assert.equal(new Script("t('ui.overview')").runInContext(english), 'Overview');
  assert.equal(new Script("t('tour.progress',{current:3,total:12})").runInContext(english), 'Step 3 / 12');
  assert.equal(new Script("t('missing.key')").runInContext(english), 'missing.key');
  assert.equal(new Script("translatedMessage('Đã kết nối')").runInContext(english), 'Connected');
  assert.equal(new Script("translatedMessage('user-supplied-provider-name')").runInContext(english), 'user-supplied-provider-name');
});
