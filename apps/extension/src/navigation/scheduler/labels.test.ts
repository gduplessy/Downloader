import { it, expect } from 'vitest';
import { schedulerLabels } from './labels';
it('all six supported locales contain every navigation control and reason', () => {
 const keys = Object.keys(schedulerLabels.en).sort();
 expect(Object.keys(schedulerLabels).sort()).toEqual(['ar','de','en','es','fr','zh-CN']);
 for (const [locale,labels] of Object.entries(schedulerLabels)) {
  expect(Object.keys(labels).sort(),locale).toEqual(keys);
  expect(Object.values(labels).every(value=>value.trim().length>0),locale).toBe(true);
 }
});
