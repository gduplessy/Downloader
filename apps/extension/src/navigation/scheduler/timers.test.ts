import { it, expect } from 'vitest';
import { countdownDuration } from './timers';
it('uses longest visible timer and ignores hidden stale timers', () => {
 expect(countdownDuration([{ text: '1:30', visible: true }, {text:'60',visible:true}, {text:'900',visible:false}])).toBe(90000);
 expect(countdownDuration([{text:'0',visible:true},{text:'30',visible:false}])).toBeNull();
 expect(countdownDuration([{text:'10:99',visible:true},{text:'99999999999',visible:true}])).toBeNull();
});
