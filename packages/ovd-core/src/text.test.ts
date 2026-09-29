import { describe, expect, it } from 'vitest';
import { createText } from './model';
import { type Measure, baselineY, relayoutText, wrapLines } from './text';

// 10px per character keeps the arithmetic obvious.
const mono: Measure = (s) => s.length * 10;
const font = { family: 'x', size: 10, weight: 400, letterSpacing: 0 };

describe('wrapLines (spec §7)', () => {
    it('breaks at spaces to fit the width', () => {
        expect(wrapLines('aaa bbb ccc', 70, font, mono)).toEqual(['aaa bbb', 'ccc']);
    });

    it('always breaks at explicit newlines', () => {
        expect(wrapLines('a\nb', 1000, font, mono)).toEqual(['a', 'b']);
    });

    it('hard-breaks a word wider than the box', () => {
        expect(wrapLines('abcdefgh', 30, font, mono)).toEqual(['abc', 'def', 'gh']);
    });
});

describe('relayoutText', () => {
    it('sizes auto-width text to its longest line', () => {
        const t = createText('t', { content: 'hello\nhi', fontSize: 10, lineHeight: 1.5 });
        relayoutText(t, mono);
        expect(t.lines).toEqual(['hello', 'hi']);
        expect(t.width).toBe(50);
        expect(t.height).toBe(30);
    });

    it('wraps fixed-width text and grows its height', () => {
        const t = createText('t', {
            content: 'aaa bbb ccc',
            box: 'fixed-width',
            width: 70,
            fontSize: 10,
            lineHeight: 2,
        });
        relayoutText(t, mono);
        expect(t.lines).toEqual(['aaa bbb', 'ccc']);
        expect(t.height).toBe(40);
    });

    it('keeps the height of fixed text', () => {
        const t = createText('t', { content: 'aaa bbb ccc', box: 'fixed', width: 70, height: 5 });
        relayoutText(t, mono);
        expect(t.height).toBe(5);
    });
});

describe('baselineY', () => {
    it('centres the em box in the line box', () => {
        // line box 20, em 10 → half-leading 5, ascent 8
        expect(baselineY({ fontSize: 10, lineHeight: 2 }, 0)).toBe(13);
        expect(baselineY({ fontSize: 10, lineHeight: 2 }, 1)).toBe(33);
    });
});
